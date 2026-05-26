import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ConnectedDevice, InstalledApp } from "@shared/types";

interface ExecuteOptions {
    serial?: string;
    timeoutMs?: number;
    encoding?: BufferEncoding | "buffer";
    allowFailure?: boolean;
}

interface ExecuteResult {
    stdout: string | Buffer;
    stderr: string;
    code: number;
}

interface ShellBatchDiagnostics<T extends string> {
    label: string;
    shouldLog: (sections: Record<T, string>) => boolean;
}

const DEFAULT_TIMEOUT_MS = 15000;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBatchSection(
    output: string,
    startMarker: string,
    endMarker: string,
    allowFromStart = false
): string {
    const pattern = new RegExp(
        `${escapeRegExp(startMarker)}\\r?\\n([\\s\\S]*?)\\r?\\n${escapeRegExp(endMarker)}`,
        "m"
    );
    const match = output.match(pattern);

    if (match?.[1] !== undefined) {
        return match[1].trim();
    }

    if (!allowFromStart) {
        return "";
    }

    const fallbackPattern = new RegExp(
        `^[\\r\\n]*([\\s\\S]*?)\\r?\\n${escapeRegExp(endMarker)}`,
        "m"
    );
    const fallbackMatch = output.match(fallbackPattern);
    return fallbackMatch?.[1]?.trim() ?? "";
}

export class AdbClient {
    constructor(private readonly adbPath: string) {}

    getAdbPath(): string {
        return this.adbPath;
    }

    private async execute(
        args: string[],
        options: ExecuteOptions = {}
    ): Promise<ExecuteResult> {
        const mergedArgs = options.serial
            ? ["-s", options.serial, ...args]
            : args;

        return new Promise((resolve, reject) => {
            execFile(
                this.adbPath,
                mergedArgs,
                {
                    windowsHide: true,
                    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
                    maxBuffer: 20 * 1024 * 1024,
                    encoding: options.encoding ?? "utf8"
                },
                (error, stdout, stderr) => {
                    const exitCode =
                        typeof error?.code === "number" ? error.code : 0;

                    if (error && !options.allowFailure) {
                        const text = Buffer.isBuffer(stdout)
                            ? stdout.toString("utf8")
                            : String(stdout ?? "");
                        const detail = String(
                            stderr || text || error.message
                        ).trim();
                        reject(
                            new Error(
                                `ADB command failed (${mergedArgs.join(" ")}): ${detail}`
                            )
                        );
                        return;
                    }

                    resolve({
                        stdout: stdout as string | Buffer,
                        stderr: (stderr ?? "").toString(),
                        code: exitCode
                    });
                }
            );
        });
    }

    async version(): Promise<string> {
        const result = await this.execute(["version"]);
        return String(result.stdout).trim();
    }

    async listDevices(): Promise<ConnectedDevice[]> {
        const result = await this.execute(["devices", "-l"]);
        const lines = String(result.stdout)
            .split(/\r?\n/)
            .slice(1)
            .map((line) => line.trim())
            .filter(Boolean);

        return lines.map((line) => {
            const parts = line.split(/\s+/);
            const serial = parts[0] ?? "";
            const status = parts[1] ?? "unknown";
            const model = line.match(/model:(\S+)/)?.[1];

            return {
                serial,
                status,
                model
            };
        });
    }

    async shell(
        serial: string,
        command: string,
        timeoutMs = DEFAULT_TIMEOUT_MS
    ): Promise<string> {
        const result = await this.execute(["shell", command], {
            serial,
            timeoutMs
        });
        return String(result.stdout).trim();
    }

    async shellAllowFailure(
        serial: string,
        command: string,
        timeoutMs = DEFAULT_TIMEOUT_MS
    ): Promise<string> {
        const result = await this.execute(["shell", command], {
            serial,
            timeoutMs,
            allowFailure: true
        });

        return String(result.stdout).trim();
    }

    async shellBatchAllowFailure<T extends string>(
        serial: string,
        commands: Record<T, string>,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        diagnostics?: ShellBatchDiagnostics<T>
    ): Promise<Record<T, string>> {
        const entries = Object.entries(commands) as Array<[T, string]>;

        if (entries.length === 0) {
            return {} as Record<T, string>;
        }

        const script = entries
            .map(([, command], index) => {
                const startMarker = `__LY_PERF_BATCH_${index}_START__`;
                const endMarker = `__LY_PERF_BATCH_${index}_END__`;

                return [
                    `echo '${startMarker}'`,
                    `(${command}) 2>/dev/null || true`,
                    `echo '${endMarker}'`
                ].join("\n");
            })
            .join("\n");

        const result = await this.execute(["shell", "sh", "-c", script], {
            serial,
            timeoutMs,
            allowFailure: true
        });
        const output = String(result.stdout ?? "");

        const sections = entries.reduce(
            (accumulator, [key], index) => {
                const startMarker = `__LY_PERF_BATCH_${index}_START__`;
                const endMarker = `__LY_PERF_BATCH_${index}_END__`;
                accumulator[key] = extractBatchSection(
                    output,
                    startMarker,
                    endMarker,
                    index === 0
                );
                return accumulator;
            },
            {} as Record<T, string>
        );

        if (diagnostics?.shouldLog(sections)) {
            console.warn("[AdbShellBatchSuspicious]", {
                label: diagnostics.label,
                serial,
                code: result.code,
                stderr: result.stderr,
                commands,
                script,
                rawOutput: output,
                sectionSummary: Object.fromEntries(
                    (Object.entries(sections) as Array<[T, string]>).map(
                        ([key, value]) => [
                            key,
                            {
                                length: value.length,
                                preview: value.slice(0, 400)
                            }
                        ]
                    )
                )
            });
        }

        return sections;
    }

    async getProp(serial: string, propKey: string): Promise<string> {
        return this.shellAllowFailure(serial, `getprop ${propKey}`);
    }

    async listPackages(
        serial: string,
        keyword?: string
    ): Promise<InstalledApp[]> {
        const userOutput = await this.shellAllowFailure(
            serial,
            "pm list packages -3"
        );
        const allOutput = await this.shellAllowFailure(
            serial,
            "pm list packages"
        );

        const userPackages = new Set(
            userOutput
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.startsWith("package:"))
                .map((line) => line.slice("package:".length).trim())
        );

        const allPackages = allOutput
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.startsWith("package:"))
            .map((line) => line.slice("package:".length).trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));

        const lowerKeyword = keyword?.trim().toLowerCase();

        return allPackages
            .filter((name) => {
                if (!lowerKeyword) {
                    return true;
                }

                return name.toLowerCase().includes(lowerKeyword);
            })
            .map((packageName) => ({
                packageName,
                isSystem: !userPackages.has(packageName)
            }));
    }

    async launchApp(serial: string, packageName: string): Promise<boolean> {
        const output = await this.shellAllowFailure(
            serial,
            `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`,
            20000
        );

        return (
            /Events injected:\s*1/i.test(output) &&
            !/No activities found to run/i.test(output)
        );
    }

    async captureScreen(serial: string, outputPath: string): Promise<void> {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });

        const result = await this.execute(["exec-out", "screencap", "-p"], {
            serial,
            timeoutMs: 20000,
            encoding: "buffer"
        });

        if (!Buffer.isBuffer(result.stdout)) {
            throw new Error(
                "Invalid screenshot payload from adb exec-out screencap."
            );
        }

        await fs.writeFile(outputPath, result.stdout);
    }

    async reverseTcp(
        serial: string,
        devicePort: number,
        localPort: number
    ): Promise<void> {
        await this.execute(
            [
                "reverse",
                `tcp:${Math.floor(devicePort)}`,
                `tcp:${Math.floor(localPort)}`
            ],
            {
                serial,
                timeoutMs: 20000
            }
        );
    }

    async removeReverseTcp(serial: string, devicePort: number): Promise<void> {
        await this.execute(
            ["reverse", "--remove", `tcp:${Math.floor(devicePort)}`],
            {
                serial,
                timeoutMs: 20000,
                allowFailure: true
            }
        );
    }
}
