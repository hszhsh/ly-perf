import { useEffect, useMemo, useState } from "react";
import type { MetricName, SessionDetail } from "@shared/types";

interface VisibleRange {
    startIndex: number;
    endIndex: number;
}

interface MetricStats {
    min: number;
    max: number;
    average: number;
}

interface LoadChartStatItem {
    label: string;
    stats: MetricStats | null;
}

function normalizeVisibleRange(
    range: VisibleRange | null,
    sampleCount: number
): VisibleRange | null {
    if (sampleCount <= 0) {
        return null;
    }

    if (!range) {
        return {
            startIndex: 0,
            endIndex: sampleCount - 1
        };
    }

    const maxIndex = sampleCount - 1;

    return {
        startIndex: Math.max(0, Math.min(maxIndex, range.startIndex)),
        endIndex: Math.max(
            0,
            Math.min(maxIndex, Math.max(range.startIndex, range.endIndex))
        )
    };
}

function calculateMetricStats(
    sessionDetail: SessionDetail | null,
    range: VisibleRange | null,
    metricName: MetricName
): MetricStats | null {
    const normalizedRange = normalizeVisibleRange(
        range,
        sessionDetail?.samples.length ?? 0
    );

    if (!sessionDetail || !normalizedRange) {
        return null;
    }

    const values = sessionDetail.samples
        .slice(normalizedRange.startIndex, normalizedRange.endIndex + 1)
        .map((sample) => sample.metrics[metricName])
        .filter((metric) => metric?.available && metric.value !== null)
        .map((metric) => metric.value as number);

    if (values.length === 0) {
        return null;
    }

    const total = values.reduce((sum, value) => sum + value, 0);

    return {
        min: Math.min(...values),
        max: Math.max(...values),
        average: total / values.length
    };
}

interface UseReportsChartRangeResult {
    normalizedLoadChartRange: VisibleRange | null;
    loadChartStats: LoadChartStatItem[];
    handleLoadChartRangeChange: (startIndex: number, endIndex: number) => void;
}

export function useReportsChartRange(
    sessionDetail: SessionDetail | null
): UseReportsChartRangeResult {
    const [loadChartRange, setLoadChartRange] = useState<VisibleRange | null>(
        null
    );

    const normalizedLoadChartRange = useMemo(
        () =>
            normalizeVisibleRange(
                loadChartRange,
                sessionDetail?.samples.length ?? 0
            ),
        [loadChartRange, sessionDetail]
    );

    const loadChartStats = useMemo(
        () => [
            {
                label:
                    sessionDetail?.config.cpuMode === "normalized"
                        ? "App CPU Norm.(%)"
                        : "App CPU(%)",
                stats: calculateMetricStats(
                    sessionDetail,
                    normalizedLoadChartRange,
                    "cpu"
                )
            },
            {
                label:
                    sessionDetail?.config.cpuMode === "normalized"
                        ? "Total CPU Norm.(%)"
                        : "Total CPU(%)",
                stats: calculateMetricStats(
                    sessionDetail,
                    normalizedLoadChartRange,
                    "cpuTotal"
                )
            },
            {
                label: "GPU(%)",
                stats: calculateMetricStats(
                    sessionDetail,
                    normalizedLoadChartRange,
                    "gpu"
                )
            }
        ],
        [normalizedLoadChartRange, sessionDetail]
    );

    useEffect(() => {
        setLoadChartRange(
            sessionDetail && sessionDetail.samples.length > 0
                ? { startIndex: 0, endIndex: sessionDetail.samples.length - 1 }
                : null
        );
    }, [sessionDetail]);

    function handleLoadChartRangeChange(
        startIndex: number,
        endIndex: number
    ): void {
        setLoadChartRange((current) =>
            current &&
            current.startIndex === startIndex &&
            current.endIndex === endIndex
                ? current
                : {
                      startIndex,
                      endIndex
                  }
        );
    }

    return {
        normalizedLoadChartRange,
        loadChartStats,
        handleLoadChartRangeChange
    };
}
