import type { CpuUsageMode, MetricDatum } from "@shared/types";
import type { CounterSnapshot } from "@main/services/MetricCollectorState";
import {
    clamp,
    metric,
    parseFirstNumber,
    round,
    shellQuote,
    unavailable
} from "@main/services/MetricCollectorCommon";

export interface CpuTickCounters {
    totalTicks: number;
    idleTicks: number;
}

export interface CpuFrequencyTotals {
    sumCurrentKhz: number;
    sumMaxKhz: number;
    source: string;
}

export interface CpuMetricResult {
    appDatum: MetricDatum;
    totalDatum: MetricDatum;
    cpuTotalTicks: number | null;
    cpuIdleTicks: number | null;
    cpuProcessTicks: number | null;
}

export const CPU_FREQ_PROBE_COMMAND =
    "if ls /sys/devices/system/cpu/cpufreq/policy* >/dev/null 2>&1; then " +
    "for d in /sys/devices/system/cpu/cpufreq/policy*; do " +
    'if [ -d "$d" ]; then ' +
    "name=${d##*/}; " +
    'cur=$(cat "$d/scaling_cur_freq" 2>/dev/null); ' +
    'if [ -z "$cur" ]; then cur=$(cat "$d/cpuinfo_cur_freq" 2>/dev/null); fi; ' +
    'max=$(cat "$d/cpuinfo_max_freq" 2>/dev/null); ' +
    'if [ -z "$max" ]; then max=$(cat "$d/scaling_max_freq" 2>/dev/null); fi; ' +
    'cpus=$(cat "$d/related_cpus" 2>/dev/null); ' +
    'echo "policy $name cur=$cur max=$max cpus=$cpus"; ' +
    "fi; " +
    "done; " +
    "else " +
    "for d in /sys/devices/system/cpu/cpu[0-9]*; do " +
    'if [ -d "$d/cpufreq" ]; then ' +
    "name=${d##*/}; " +
    'cur=$(cat "$d/cpufreq/scaling_cur_freq" 2>/dev/null); ' +
    'if [ -z "$cur" ]; then cur=$(cat "$d/cpufreq/cpuinfo_cur_freq" 2>/dev/null); fi; ' +
    'max=$(cat "$d/cpufreq/cpuinfo_max_freq" 2>/dev/null); ' +
    'if [ -z "$max" ]; then max=$(cat "$d/cpufreq/scaling_max_freq" 2>/dev/null); fi; ' +
    'echo "cpu $name cur=$cur max=$max"; ' +
    "fi; " +
    "done; " +
    "fi";

export function buildProcessCpuStatCommand(packageName: string): string {
    const quotedPackageName = shellQuote(packageName);

    return (
        `pkg=${quotedPackageName}; ` +
        "ps -A -o PID,ARGS 2>/dev/null | " +
        "while read -r pid args; do " +
        "case \"$pid\" in ''|*[!0-9]*) continue ;; esac; " +
        'case "$args" in "$pkg"|"$pkg":*) cat "/proc/$pid/stat" 2>/dev/null ;; esac; ' +
        "done"
    );
}

export function parseCpuFrequencyTotals(
    raw: string
): CpuFrequencyTotals | null {
    let sumCurrentKhz = 0;
    let sumMaxKhz = 0;
    let source: string | null = null;

    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (line.startsWith("policy ")) {
            const currentKhz =
                parseFirstNumber(line.match(/\bcur=([^\s]+)/)?.[1] ?? "") ?? 0;
            const maxKhz = parseFirstNumber(
                line.match(/\bmax=([^\s]+)/)?.[1] ?? ""
            );
            const cpuCount = Math.max(
                (line.match(/\bcpus=(.+)$/)?.[1] ?? "")
                    .split(/\s+/)
                    .filter(Boolean).length,
                1
            );

            if (maxKhz === null || maxKhz <= 0) {
                continue;
            }

            sumCurrentKhz += clamp(currentKhz, 0, maxKhz) * cpuCount;
            sumMaxKhz += maxKhz * cpuCount;
            source = "cpufreq policy";
            continue;
        }

        if (line.startsWith("cpu ")) {
            const currentKhz =
                parseFirstNumber(line.match(/\bcur=([^\s]+)/)?.[1] ?? "") ?? 0;
            const maxKhz = parseFirstNumber(
                line.match(/\bmax=([^\s]+)/)?.[1] ?? ""
            );

            if (maxKhz === null || maxKhz <= 0) {
                continue;
            }

            sumCurrentKhz += clamp(currentKhz, 0, maxKhz);
            sumMaxKhz += maxKhz;
            source = source ?? "cpufreq per-cpu";
        }
    }

    if (sumMaxKhz <= 0 || source === null) {
        return null;
    }

    return {
        sumCurrentKhz,
        sumMaxKhz,
        source
    };
}

export function parseCpuTickCounters(raw: string): CpuTickCounters | null {
    const cpuLine = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith("cpu "));

    if (!cpuLine) {
        return null;
    }

    const parts = cpuLine
        .split(/\s+/)
        .slice(1)
        .map((part) => Number(part));

    if (
        parts.length < 4 ||
        parts.some((value) => !Number.isFinite(value) || value < 0)
    ) {
        return null;
    }

    const totalTicks = parts.reduce((sum, value) => sum + value, 0);
    const idleTicks = (parts[3] ?? 0) + (parts[4] ?? 0);

    if (totalTicks <= 0) {
        return null;
    }

    return {
        totalTicks,
        idleTicks
    };
}

export function parseProcessCpuTicks(raw: string): number | null {
    let totalTicks = 0;
    let found = false;

    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        const commEnd = line.lastIndexOf(")");
        if (commEnd < 0) {
            continue;
        }

        const statParts = line
            .slice(commEnd + 1)
            .trim()
            .split(/\s+/);
        const utime = Number(statParts[11]);
        const stime = Number(statParts[12]);

        if (!Number.isFinite(utime) || !Number.isFinite(stime)) {
            continue;
        }

        totalTicks += utime + stime;
        found = true;
    }

    return found ? totalTicks : null;
}

export function parseCpuMetrics(
    cpuStatInfo: string,
    processCpuStatInfo: string,
    prev: CounterSnapshot | undefined,
    cpuMode: CpuUsageMode,
    cpuFrequencyInfo: string
): CpuMetricResult {
    const cpuCounters = parseCpuTickCounters(cpuStatInfo);
    const cpuTotalTicks = cpuCounters?.totalTicks ?? null;
    const cpuIdleTicks = cpuCounters?.idleTicks ?? null;
    const cpuProcessTicks = parseProcessCpuTicks(processCpuStatInfo);
    const processSource = "/proc/stat + /proc/[pid]/stat";
    const totalSource = "/proc/stat";
    const cpuFrequencies =
        cpuMode === "normalized"
            ? parseCpuFrequencyTotals(cpuFrequencyInfo)
            : null;
    const frequencyRatio =
        cpuMode === "normalized" && cpuFrequencies
            ? clamp(
                  cpuFrequencies.sumCurrentKhz / cpuFrequencies.sumMaxKhz,
                  0,
                  1
              )
            : null;

    if (cpuTotalTicks === null || cpuIdleTicks === null) {
        return {
            appDatum: unavailable("%", "无法读取系统CPU时间", processSource),
            totalDatum: unavailable("%", "无法读取系统CPU时间", totalSource),
            cpuTotalTicks,
            cpuIdleTicks,
            cpuProcessTicks
        };
    }

    if (!prev || prev.cpuTotalTicks === null || prev.cpuIdleTicks === null) {
        return {
            appDatum:
                cpuProcessTicks === null
                    ? unavailable("%", "无法读取目标进程CPU时间", processSource)
                    : unavailable(
                          "%",
                          "等待下一次采样计算CPU占用",
                          processSource
                      ),
            totalDatum: unavailable(
                "%",
                "等待下一次采样计算总CPU占用",
                totalSource
            ),
            cpuTotalTicks,
            cpuIdleTicks,
            cpuProcessTicks
        };
    }

    const deltaTotalTicks = cpuTotalTicks - prev.cpuTotalTicks;
    const deltaIdleTicks = cpuIdleTicks - prev.cpuIdleTicks;

    if (deltaTotalTicks <= 0) {
        return {
            appDatum:
                cpuProcessTicks === null
                    ? unavailable("%", "无法读取目标进程CPU时间", processSource)
                    : unavailable(
                          "%",
                          "系统CPU时间未推进，等待下一次采样",
                          processSource
                      ),
            totalDatum: unavailable(
                "%",
                "系统CPU时间未推进，等待下一次采样",
                totalSource
            ),
            cpuTotalTicks,
            cpuIdleTicks,
            cpuProcessTicks
        };
    }

    const traditionalTotalCpuUsage = clamp(
        ((deltaTotalTicks - Math.max(deltaIdleTicks, 0)) / deltaTotalTicks) *
            100,
        0,
        100
    );

    const totalDatum =
        cpuMode === "normalized"
            ? frequencyRatio === null
                ? unavailable(
                      "%",
                      "无法读取CPU频率，无法计算规范化总CPU占用",
                      `${totalSource} + cpufreq`
                  )
                : metric(
                      round(
                          clamp(
                              traditionalTotalCpuUsage * frequencyRatio,
                              0,
                              100
                          )
                      ),
                      "%",
                      `${totalSource} + ${cpuFrequencies?.source}`
                  )
            : metric(round(traditionalTotalCpuUsage), "%", totalSource);

    let appDatum: MetricDatum;

    if (cpuProcessTicks === null) {
        appDatum = unavailable("%", "无法读取目标进程CPU时间", processSource);
    } else if (prev.cpuProcessTicks === null) {
        appDatum = unavailable("%", "等待下一次采样计算CPU占用", processSource);
    } else {
        const deltaProcessTicks = cpuProcessTicks - prev.cpuProcessTicks;

        if (deltaProcessTicks < 0) {
            appDatum = unavailable(
                "%",
                "目标进程CPU时间回退，等待下一次采样",
                processSource
            );
        } else {
            const traditionalAppCpuUsage = clamp(
                (deltaProcessTicks / deltaTotalTicks) * 100,
                0,
                100
            );

            appDatum =
                cpuMode === "normalized"
                    ? frequencyRatio === null
                        ? unavailable(
                              "%",
                              "无法读取CPU频率，无法计算规范化CPU占用",
                              `${processSource} + cpufreq`
                          )
                        : metric(
                              round(
                                  clamp(
                                      traditionalAppCpuUsage * frequencyRatio,
                                      0,
                                      100
                                  )
                              ),
                              "%",
                              `${processSource} + ${cpuFrequencies?.source}`
                          )
                    : metric(round(traditionalAppCpuUsage), "%", processSource);
        }
    }

    return {
        appDatum,
        totalDatum,
        cpuTotalTicks,
        cpuIdleTicks,
        cpuProcessTicks
    };
}
