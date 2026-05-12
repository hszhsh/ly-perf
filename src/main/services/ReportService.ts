import { promises as fs } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import type { ExportResult, SessionDetail } from "@shared/types";
import { SessionStore } from "@main/services/SessionStore";

const METRIC_NAMES = [
    "fps",
    "jank",
    "bigJank",
    "cpu",
    "cpuTotal",
    "memory",
    "memoryGraphics",
    "memoryNativeHeap",
    "memoryPrivateOther",
    "networkRx",
    "networkTx",
    "networkTotal",
    "diskRead",
    "diskWrite",
    "gpu",
    "power",
    "temperature"
] as const;

function toWebPath(value: string): string {
    return value.split(path.sep).join("/");
}

export class ReportService {
    constructor(
        private readonly store: SessionStore,
        private readonly appRoot: string
    ) {}

    async exportSession(
        sessionId: string,
        format: "html" | "xlsx"
    ): Promise<ExportResult> {
        if (format === "html") {
            return this.exportHtml(sessionId);
        }

        return this.exportXlsx(sessionId);
    }

    private async exportHtml(sessionId: string): Promise<ExportResult> {
        const session = await this.store.getSession(sessionId);
        const outputDir = path.join(
            this.store.getDataDir(),
            "exports",
            sessionId,
            "html"
        );

        await fs.rm(outputDir, { recursive: true, force: true });
        await fs.mkdir(outputDir, { recursive: true });

        const reportSession = await this.copyScreenshotsForReport(
            session,
            outputDir
        );

        const echartsSource = path.join(
            this.appRoot,
            "node_modules",
            "echarts",
            "dist",
            "echarts.min.js"
        );
        const echartsTarget = path.join(outputDir, "echarts.min.js");

        await fs.copyFile(echartsSource, echartsTarget);
        await fs.writeFile(
            path.join(outputDir, "report.json"),
            JSON.stringify(reportSession, null, 2),
            "utf8"
        );
        await fs.writeFile(
            path.join(outputDir, "index.html"),
            this.buildHtmlTemplate(),
            "utf8"
        );

        return {
            format: "html",
            outputPath: path.join(outputDir, "index.html")
        };
    }

    private async exportXlsx(sessionId: string): Promise<ExportResult> {
        const session = await this.store.getSession(sessionId);
        const outputDir = path.join(
            this.store.getDataDir(),
            "exports",
            sessionId,
            "xlsx"
        );

        await fs.mkdir(outputDir, { recursive: true });

        const rows = session.samples.map((sample) => {
            const row: Record<string, number | string | null> = {
                timestamp: new Date(sample.timestamp).toISOString(),
                screenshot: sample.screenshotPath ?? ""
            };

            for (const metricName of METRIC_NAMES) {
                row[metricName] = sample.metrics[metricName]?.value ?? null;
            }

            return row;
        });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(rows);

        XLSX.utils.book_append_sheet(workbook, worksheet, "metrics");

        const outputPath = path.join(outputDir, `${sessionId}.xlsx`);
        XLSX.writeFile(workbook, outputPath);

        return {
            format: "xlsx",
            outputPath
        };
    }

    private async copyScreenshotsForReport(
        session: SessionDetail,
        outputDir: string
    ): Promise<SessionDetail> {
        const screenshotDir = path.join(outputDir, "screenshots");
        await fs.mkdir(screenshotDir, { recursive: true });

        const copiedPathMap = new Map<string, string>();

        const samples = await Promise.all(
            session.samples.map(async (sample, index) => {
                if (!sample.screenshotPath) {
                    return sample;
                }

                if (!copiedPathMap.has(sample.screenshotPath)) {
                    const ext = path.extname(sample.screenshotPath) || ".png";
                    const fileName = `${index.toString().padStart(6, "0")}${ext}`;
                    const targetPath = path.join(screenshotDir, fileName);

                    try {
                        await fs.copyFile(sample.screenshotPath, targetPath);
                        copiedPathMap.set(
                            sample.screenshotPath,
                            toWebPath(path.join("screenshots", fileName))
                        );
                    } catch {
                        copiedPathMap.set(sample.screenshotPath, "");
                    }
                }

                const copied =
                    copiedPathMap.get(sample.screenshotPath) || undefined;

                return {
                    ...sample,
                    screenshotPath: copied
                };
            })
        );

        return {
            ...session,
            samples
        };
    }

    private buildHtmlTemplate(): string {
        return `<!doctype html>
<html lang="zh-CN">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>LY Perf HTML Report</title>
        <script src="./echarts.min.js"></script>
        <style>
            body {
                margin: 0;
                background: radial-gradient(circle at 20% 20%, #2f4156, #18212d 60%, #10151f 100%);
                color: #dbe4ee;
                font-family: "Bahnschrift", "Trebuchet MS", sans-serif;
            }
            .wrap {
                display: grid;
                grid-template-columns: 2fr 1fr;
                gap: 12px;
                padding: 12px;
                min-height: 100vh;
                box-sizing: border-box;
            }
            .panel {
                background: rgba(10, 16, 24, 0.78);
                border: 1px solid rgba(102, 128, 153, 0.35);
                border-radius: 12px;
                overflow: hidden;
            }
            #chart {
                height: 82vh;
            }
            .preview {
                padding: 10px;
            }
            .preview img {
                width: 100%;
                border-radius: 8px;
                background: #0f141c;
                border: 1px solid rgba(102, 128, 153, 0.35);
            }
            .meta {
                font-size: 12px;
                color: #8ca0b8;
                margin-bottom: 8px;
            }
            .title {
                margin: 0;
                padding: 12px;
                border-bottom: 1px solid rgba(102, 128, 153, 0.35);
                letter-spacing: 0.4px;
            }
        </style>
    </head>
    <body>
        <div class="wrap">
            <section class="panel">
                <h3 class="title">Performance Timeline</h3>
                <div id="chart"></div>
            </section>
            <section class="panel preview">
                <div id="meta" class="meta"></div>
                <img id="shot" alt="screenshot preview" />
            </section>
        </div>

        <script>
            const METRICS = [
                "fps",
                "jank",
                "bigJank",
                "cpu",
                "cpuTotal",
                "memory",
                "memoryGraphics",
                "memoryNativeHeap",
                "memoryPrivateOther",
                "networkRx",
                "networkTx",
                "networkTotal",
                "diskRead",
                "diskWrite",
                "gpu",
                "power",
                "temperature"
            ];

            fetch("./report.json")
                .then((res) => res.json())
                .then((report) => {
                    const chart = echarts.init(document.getElementById("chart"));
                    const labels = report.samples.map((sample) => new Date(sample.timestamp).toLocaleTimeString());

                    const series = METRICS.map((name) => ({
                        type: "line",
                        name,
                        smooth: false,
                        showSymbol: false,
                        data: report.samples.map((sample) => sample.metrics?.[name]?.value ?? null)
                    }));

                    chart.setOption({
                        tooltip: {
                            trigger: "axis"
                        },
                        legend: {
                            top: 8,
                            textStyle: {
                                color: "#cad5e2"
                            }
                        },
                        grid: {
                            left: 56,
                            right: 24,
                            top: 48,
                            bottom: 70
                        },
                        xAxis: {
                            type: "category",
                            data: labels,
                            axisLabel: { color: "#9db0c7" }
                        },
                        yAxis: {
                            type: "value",
                            axisLabel: { color: "#9db0c7" },
                            splitLine: { lineStyle: { color: "rgba(140,160,184,0.2)" } }
                        },
                        dataZoom: [
                            { type: "inside" },
                            { type: "slider", height: 24, bottom: 18 }
                        ],
                        series
                    });

                    const shot = document.getElementById("shot");
                    const meta = document.getElementById("meta");
                    const sessionTitle = report.displayName || report.packageName;

                    chart.on("updateAxisPointer", (event) => {
                        const axisInfo = event.axesInfo && event.axesInfo[0];
                        if (!axisInfo) {
                            return;
                        }

                        const index = axisInfo.value;
                        const sample = report.samples[index];
                        if (!sample) {
                            return;
                        }

                        meta.textContent =
                            new Date(sample.timestamp).toLocaleString() +
                            " | " +
                            sessionTitle +
                            " | " +
                            report.serial;

                        if (sample.screenshotPath) {
                            shot.src = sample.screenshotPath;
                        }
                    });
                });
        </script>
    </body>
</html>
`;
    }
}
