import type { MetricDatum } from "@shared/types";
import {
    metric,
    round,
    unavailable
} from "@main/services/MetricCollectorCommon";

export interface MemoryMetricResult {
    totalPss: MetricDatum;
    graphics: MetricDatum;
    nativeHeap: MetricDatum;
    privateOther: MetricDatum;
}

export function parseMemoryMetrics(memInfo: string): MemoryMetricResult {
    const totalPssKb = parseMemInfoKbValue(memInfo, [
        /TOTAL PSS:\s*([\d,]+)/i,
        /^\s*TOTAL\s+([\d,]+)\s+/im
    ]);
    const graphicsKb = parseNamedMemInfoKb(memInfo, "Graphics");
    const nativeHeapKb = parseNamedMemInfoKb(memInfo, "Native Heap");
    const privateOtherKb = parseNamedMemInfoKb(memInfo, "Private Other");

    return {
        totalPss: toMemoryMetric(totalPssKb, "PSS总内存"),
        graphics: toMemoryMetric(graphicsKb, "Graphics"),
        nativeHeap: toMemoryMetric(nativeHeapKb, "Native Heap"),
        privateOther: toMemoryMetric(privateOtherKb, "Private Other")
    };
}

function parseNamedMemInfoKb(memInfo: string, label: string): number | null {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return parseMemInfoKbValue(memInfo, [
        new RegExp(`^\\s*${escaped}\\s*:?\\s*([\\d,]+)\\b`, "im")
    ]);
}

function parseMemInfoKbValue(
    memInfo: string,
    patterns: RegExp[]
): number | null {
    for (const pattern of patterns) {
        const rawValue = memInfo.match(pattern)?.[1];
        if (!rawValue) {
            continue;
        }

        const value = Number(rawValue.replace(/,/g, ""));
        if (Number.isFinite(value)) {
            return value;
        }
    }

    return null;
}

function toMemoryMetric(kbValue: number | null, label: string): MetricDatum {
    if (kbValue === null) {
        return unavailable("MB", `无法解析${label}`, "dumpsys meminfo");
    }

    return metric(round(kbValue / 1024), "MB", "dumpsys meminfo");
}
