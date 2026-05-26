import { useCallback, useMemo, useState } from "react";
import type {
    DeepMonitorMetricDefinition,
    DeepMonitorSample,
    DeepMonitorStatComputation,
    MetricName,
    SessionDetail
} from "@shared/types";
import { getChartTimeDomain } from "@renderer/components/MetricChart";
import {
    getDeepMonitorMetricDefinitionMap,
    isNumericCustomChartDefinition,
    getSortedCustomChartDefinitions,
    getSortedDeepMonitorSamples
} from "@renderer/components/metricChartPresets";

export interface VisibleRange {
    startIndex: number;
    endIndex: number;
}

export interface VisibleTimeRange {
    startTimestamp: number;
    endTimestamp: number;
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

export interface CustomChartStatItem {
    key: string;
    label: string;
    unit: string;
    color?: string;
    computations: DeepMonitorStatComputation[];
    stats: MetricStats | null;
}

export interface CustomChartStatsCard {
    chartId: string;
    title: string;
    range: VisibleRange | null;
    items: CustomChartStatItem[];
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

function normalizeVisibleTimeRange(
    range: VisibleTimeRange | null,
    fullRange: VisibleTimeRange | null
): VisibleTimeRange | null {
    if (!fullRange) {
        return null;
    }

    if (!range) {
        return fullRange;
    }

    const startTimestamp = Math.max(
        fullRange.startTimestamp,
        Math.floor(range.startTimestamp)
    );
    const endTimestamp = Math.min(
        fullRange.endTimestamp,
        Math.ceil(range.endTimestamp)
    );

    if (endTimestamp < startTimestamp) {
        return fullRange;
    }

    return {
        startTimestamp,
        endTimestamp
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

function calculateCustomMetricStats(
    samples: DeepMonitorSample[],
    range: VisibleRange | null,
    metricKey: string
): MetricStats | null {
    const normalizedRange = normalizeVisibleRange(range, samples.length);

    if (!normalizedRange) {
        return null;
    }

    const values = samples
        .slice(normalizedRange.startIndex, normalizedRange.endIndex + 1)
        .map((sample) => sample.values[metricKey])
        .filter(
            (value): value is number =>
                typeof value === "number" && Number.isFinite(value)
        );

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

function createCustomChartStatItem(params: {
    metricKey: string;
    definition: DeepMonitorMetricDefinition | undefined;
    computations: DeepMonitorStatComputation[];
    samples: DeepMonitorSample[];
    range: VisibleRange | null;
}): CustomChartStatItem {
    const { metricKey, definition, computations, samples, range } = params;

    return {
        key: metricKey,
        label: definition?.label ?? metricKey,
        unit: definition?.unit ?? "",
        color: definition?.color,
        computations,
        stats: calculateCustomMetricStats(samples, range, metricKey)
    };
}

interface UseReportsChartRangeResult {
    restoredVisibleTimeRange: VisibleTimeRange | null;
    normalizedLoadChartRange: VisibleRange | null;
    loadChartStats: LoadChartStatItem[];
    customChartRangesById: Record<string, VisibleRange | null>;
    customChartStatsCards: CustomChartStatsCard[];
    handleVisibleTimeRangeChange: (range: VisibleTimeRange) => void;
    handleLoadChartRangeChange: (startIndex: number, endIndex: number) => void;
    handleCustomChartRangeChange: (
        chartId: string,
        startIndex: number,
        endIndex: number
    ) => void;
}

export function useReportsChartRange(
    sessionDetail: SessionDetail | null
): UseReportsChartRangeResult {
    const sessionId = sessionDetail?.id ?? null;
    const [visibleTimeRangesBySessionId, setVisibleTimeRangesBySessionId] =
        useState<Record<string, VisibleTimeRange | null>>({});
    const [loadChartRangesBySessionId, setLoadChartRangesBySessionId] =
        useState<Record<string, VisibleRange | null>>({});
    const [customChartRangesBySessionId, setCustomChartRangesBySessionId] =
        useState<Record<string, Record<string, VisibleRange | null>>>({});

    const sortedCustomSamples = useMemo(
        () => getSortedDeepMonitorSamples(sessionDetail?.customSamples),
        [sessionDetail?.customSamples]
    );
    const sharedTimeDomain = useMemo(
        () =>
            getChartTimeDomain(
                sessionDetail?.samples ?? [],
                sortedCustomSamples,
                sessionDetail?.events ?? []
            ),
        [sessionDetail?.events, sessionDetail?.samples, sortedCustomSamples]
    );
    const metricDefinitionMap = useMemo(
        () =>
            getDeepMonitorMetricDefinitionMap(
                sessionDetail?.customMetricDefinitions
            ),
        [sessionDetail?.customMetricDefinitions]
    );
    const sortedCustomChartDefinitions = useMemo(
        () =>
            getSortedCustomChartDefinitions(
                sessionDetail?.customChartDefinitions
            ).filter((chartDefinition) =>
                isNumericCustomChartDefinition({
                    chartDefinition,
                    metricDefinitionMap
                })
            ),
        [metricDefinitionMap, sessionDetail?.customChartDefinitions]
    );
    const currentLoadChartRange = useMemo(
        () => (sessionId ? loadChartRangesBySessionId[sessionId] ?? null : null),
        [loadChartRangesBySessionId, sessionId]
    );
    const currentCustomChartRangesById = useMemo(
        () =>
            sessionId
                ? customChartRangesBySessionId[sessionId] ?? {}
                : {},
        [customChartRangesBySessionId, sessionId]
    );
    const restoredVisibleTimeRange = useMemo(
        () =>
            normalizeVisibleTimeRange(
                sessionId
                    ? visibleTimeRangesBySessionId[sessionId] ?? null
                    : null,
                sharedTimeDomain
            ),
        [sessionId, sharedTimeDomain, visibleTimeRangesBySessionId]
    );

    const normalizedLoadChartRange = useMemo(
        () =>
            normalizeVisibleRange(
                currentLoadChartRange,
                sessionDetail?.samples.length ?? 0
            ),
        [currentLoadChartRange, sessionDetail?.samples.length]
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

    const normalizedCustomChartRanges = useMemo(
        () =>
            Object.fromEntries(
                sortedCustomChartDefinitions.map((chartDefinition) => [
                    chartDefinition.id,
                    normalizeVisibleRange(
                        currentCustomChartRangesById[chartDefinition.id] ?? null,
                        sortedCustomSamples.length
                    )
                ])
            ) as Record<string, VisibleRange | null>,
        [
            currentCustomChartRangesById,
            sortedCustomChartDefinitions,
            sortedCustomSamples.length
        ]
    );

    const customChartStatsCards = useMemo(
        () =>
            sortedCustomChartDefinitions
                .filter(
                    (chartDefinition) =>
                        chartDefinition.stats.enabled &&
                        chartDefinition.stats.surface !== "monitor-only"
                )
                .map((chartDefinition) => {
                    const metricKeys =
                        chartDefinition.stats.metricKeys?.filter(Boolean) ??
                        chartDefinition.metricKeys;

                    if (metricKeys.length === 0) {
                        return null;
                    }

                    const range =
                        chartDefinition.stats.scope === "whole-session"
                            ? normalizeVisibleRange(null, sortedCustomSamples.length)
                            : normalizedCustomChartRanges[chartDefinition.id] ?? null;

                    return {
                        chartId: chartDefinition.id,
                        title: chartDefinition.title,
                        range,
                        items: metricKeys.map((metricKey) =>
                            createCustomChartStatItem({
                                metricKey,
                                definition: metricDefinitionMap.get(metricKey),
                                computations: chartDefinition.stats.computations,
                                samples: sortedCustomSamples,
                                range
                            })
                        )
                    } satisfies CustomChartStatsCard;
                })
                .filter(
                    (card): card is CustomChartStatsCard =>
                        card !== null && card.items.length > 0
                ),
        [
            metricDefinitionMap,
            normalizedCustomChartRanges,
            sortedCustomChartDefinitions,
            sortedCustomSamples
        ]
    );

    const handleVisibleTimeRangeChange = useCallback((range: VisibleTimeRange): void => {
        if (!sessionId) {
            return;
        }

        const normalizedRange = {
            startTimestamp: Math.floor(range.startTimestamp),
            endTimestamp: Math.ceil(range.endTimestamp)
        } satisfies VisibleTimeRange;

        setVisibleTimeRangesBySessionId((current) => {
            const previous = current[sessionId] ?? null;

            if (
                previous &&
                previous.startTimestamp === normalizedRange.startTimestamp &&
                previous.endTimestamp === normalizedRange.endTimestamp
            ) {
                return current;
            }

            return {
                ...current,
                [sessionId]: normalizedRange
            };
        });
    }, [sessionId]);

    const handleLoadChartRangeChange = useCallback((
        startIndex: number,
        endIndex: number
    ): void => {
        if (!sessionId) {
            return;
        }

        setLoadChartRangesBySessionId((current) => {
            const previous = current[sessionId] ?? null;

            if (
                previous &&
                previous.startIndex === startIndex &&
                previous.endIndex === endIndex
            ) {
                return current;
            }

            return {
                ...current,
                [sessionId]: {
                    startIndex,
                    endIndex
                }
            };
        });
    }, [sessionId]);

    const handleCustomChartRangeChange = useCallback((
        chartId: string,
        startIndex: number,
        endIndex: number
    ): void => {
        if (!sessionId) {
            return;
        }

        setCustomChartRangesBySessionId((current) => {
            const sessionRanges = current[sessionId] ?? {};
            const previous = sessionRanges[chartId] ?? null;

            if (
                previous &&
                previous.startIndex === startIndex &&
                previous.endIndex === endIndex
            ) {
                return current;
            }

            return {
                ...current,
                [sessionId]: {
                    ...sessionRanges,
                    [chartId]: {
                        startIndex,
                        endIndex
                    }
                }
            };
        });
    }, [sessionId]);

    return {
        restoredVisibleTimeRange,
        normalizedLoadChartRange,
        loadChartStats,
        customChartRangesById: normalizedCustomChartRanges,
        customChartStatsCards,
        handleVisibleTimeRangeChange,
        handleLoadChartRangeChange,
        handleCustomChartRangeChange
    };
}
