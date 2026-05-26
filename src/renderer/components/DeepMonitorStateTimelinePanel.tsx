import { type CSSProperties, useMemo } from "react";
import type {
    DeepMonitorChartDefinition,
    DeepMonitorMetricDefinition,
    DeepMonitorSample
} from "@shared/types";
import {
    getChartTimeDomain,
    type ChartFocusRequest,
    type ChartRangeRequest,
    type ChartTimeDomain
} from "@renderer/components/MetricChart";
import {
    getCustomStateCharts,
    getDeepMonitorMetricDefinitionMap,
    getSortedCustomChartDefinitions,
    getSortedDeepMonitorSamples,
    type DeepMonitorStateSegment,
    formatDeepMonitorStateValue
} from "@renderer/components/metricChartPresets";
import styles from "./DeepMonitorStateTimelinePanel.module.css";

interface DeepMonitorStateTimelinePanelProps {
    metricDefinitions: DeepMonitorMetricDefinition[];
    chartDefinitions: DeepMonitorChartDefinition[];
    samples: DeepMonitorSample[];
    timeDomain?: ChartTimeDomain | null;
    focusRequest?: ChartFocusRequest | null;
    rangeRequest?: ChartRangeRequest | null;
    onTimestampFocus?: (timestamp: number) => void;
    onTimeRangeFocus?: (range: ChartTimeDomain) => void;
}

function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString(undefined, {
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3
    });
}

function formatTimeRange(startTimestamp: number, endTimestamp: number): string {
    if (startTimestamp === endTimestamp) {
        return formatTimestamp(startTimestamp);
    }

    return `${formatTimestamp(startTimestamp)} - ${formatTimestamp(endTimestamp)}`;
}

function formatDuration(durationMs: number): string {
    if (durationMs <= 0) {
        return "single sample";
    }

    if (durationMs < 1000) {
        return `${Math.round(durationMs)} ms`;
    }

    if (durationMs < 60_000) {
        return `${(durationMs / 1000).toFixed(1)} s`;
    }

    if (durationMs < 3_600_000) {
        return `${(durationMs / 60_000).toFixed(1)} min`;
    }

    return `${(durationMs / 3_600_000).toFixed(1)} h`;
}

function getAverageSampleInterval(samples: DeepMonitorSample[]): number {
    if (samples.length <= 1) {
        return 1000;
    }

    const firstTimestamp = samples[0]?.timestamp ?? 0;
    const lastTimestamp =
        samples[samples.length - 1]?.timestamp ?? firstTimestamp;

    return Math.max(1, (lastTimestamp - firstTimestamp) / (samples.length - 1));
}

function buildSegmentFocusRange(params: {
    segment: DeepMonitorStateSegment;
    fullRange: ChartTimeDomain | null;
    averageSampleInterval: number;
}): ChartTimeDomain | null {
    const { segment, fullRange, averageSampleInterval } = params;

    if (!fullRange) {
        return null;
    }

    const contextPadding = Math.max(250, Math.round(averageSampleInterval / 2));
    const minimumWindow = Math.max(1000, Math.round(averageSampleInterval));
    let startTimestamp = Math.floor(segment.startTimestamp - contextPadding);
    let endTimestamp = Math.ceil(segment.endTimestamp + contextPadding);

    if (endTimestamp - startTimestamp < minimumWindow) {
        const centerTimestamp =
            (segment.startTimestamp + segment.endTimestamp) / 2;
        startTimestamp = Math.floor(centerTimestamp - minimumWindow / 2);
        endTimestamp = Math.ceil(centerTimestamp + minimumWindow / 2);
    }

    startTimestamp = Math.max(fullRange.startTimestamp, startTimestamp);
    endTimestamp = Math.min(fullRange.endTimestamp, endTimestamp);

    if (endTimestamp <= startTimestamp) {
        return fullRange.endTimestamp > fullRange.startTimestamp
            ? fullRange
            : null;
    }

    return {
        startTimestamp,
        endTimestamp
    };
}

function clampVisibleRange(params: {
    fullRange: ChartTimeDomain | null;
    requestedRange: ChartRangeRequest | null | undefined;
}): ChartTimeDomain | null {
    const { fullRange, requestedRange } = params;

    if (!fullRange) {
        return null;
    }

    if (!requestedRange) {
        return fullRange;
    }

    const startTimestamp = Math.max(
        fullRange.startTimestamp,
        Math.floor(requestedRange.startTimestamp)
    );
    const endTimestamp = Math.min(
        fullRange.endTimestamp,
        Math.ceil(requestedRange.endTimestamp)
    );

    if (endTimestamp <= startTimestamp) {
        return fullRange;
    }

    return {
        startTimestamp,
        endTimestamp
    };
}

function intersectsVisibleRange(
    segment: DeepMonitorStateSegment,
    visibleRange: ChartTimeDomain | null
): boolean {
    if (!visibleRange) {
        return true;
    }

    return (
        segment.endTimestamp >= visibleRange.startTimestamp &&
        segment.startTimestamp <= visibleRange.endTimestamp
    );
}

function findClosestSegment(
    segments: DeepMonitorStateSegment[],
    timestamp: number | null
): DeepMonitorStateSegment | null {
    if (timestamp === null || segments.length === 0) {
        return null;
    }

    let closestSegment: DeepMonitorStateSegment | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const segment of segments) {
        const distance =
            timestamp < segment.startTimestamp
                ? segment.startTimestamp - timestamp
                : timestamp > segment.endTimestamp
                  ? timestamp - segment.endTimestamp
                  : 0;

        if (distance < closestDistance) {
            closestDistance = distance;
            closestSegment = segment;
        }
    }

    return closestSegment;
}

export function DeepMonitorStateTimelinePanel({
    metricDefinitions,
    chartDefinitions,
    samples,
    timeDomain,
    focusRequest,
    rangeRequest,
    onTimestampFocus,
    onTimeRangeFocus
}: DeepMonitorStateTimelinePanelProps) {
    const sortedCustomSamples = useMemo(
        () => getSortedDeepMonitorSamples(samples),
        [samples]
    );
    const metricDefinitionMap = useMemo(
        () => getDeepMonitorMetricDefinitionMap(metricDefinitions),
        [metricDefinitions]
    );
    const sortedChartDefinitions = useMemo(
        () => getSortedCustomChartDefinitions(chartDefinitions),
        [chartDefinitions]
    );
    const stateCharts = useMemo(
        () =>
            getCustomStateCharts({
                chartDefinitions: sortedChartDefinitions,
                metricDefinitionMap,
                samples: sortedCustomSamples
            }),
        [metricDefinitionMap, sortedChartDefinitions, sortedCustomSamples]
    );
    const fullTimeDomain = useMemo(
        () => timeDomain ?? getChartTimeDomain(sortedCustomSamples),
        [sortedCustomSamples, timeDomain]
    );
    const averageSampleInterval = useMemo(
        () => getAverageSampleInterval(sortedCustomSamples),
        [sortedCustomSamples]
    );
    const visibleRange = useMemo(
        () =>
            clampVisibleRange({
                fullRange: fullTimeDomain,
                requestedRange: rangeRequest
            }),
        [fullTimeDomain, rangeRequest]
    );
    const activeTimestamp = focusRequest?.timestamp ?? null;

    if (stateCharts.length === 0) {
        return null;
    }

    return (
        <section className={styles.panel}>
            <div className={styles.header}>
                <div className={styles.headerTitle}>
                    <strong>状态时间线</strong>
                    <span>
                        非数值自定义 deep monitor 数据按时间区间聚合展示，点击区间会把图表缩放到对应时间段。
                    </span>
                </div>

                <span className={styles.rangeBadge}>
                    {visibleRange
                        ? `Visible Range: ${formatTimeRange(
                              visibleRange.startTimestamp,
                              visibleRange.endTimestamp
                          )}`
                        : "Visible Range: all"}
                </span>
            </div>

            <div className={styles.chartStack}>
                {stateCharts.map(({ chartDefinition, tracks }) => (
                    <article
                        key={chartDefinition.id}
                        className={styles.chartCard}
                    >
                        <div className={styles.chartHeader}>
                            <div className={styles.chartTitleBlock}>
                                <strong>{chartDefinition.title}</strong>
                                <span>
                                    {chartDefinition.description ||
                                        "非数值自定义指标按区间展示。"}
                                </span>
                            </div>

                            <span className={styles.chartMeta}>
                                {tracks.length} track{tracks.length === 1 ? "" : "s"}
                            </span>
                        </div>

                        <div className={styles.trackStack}>
                            {tracks.map((track) => {
                                const visibleSegments = track.segments.filter(
                                    (segment) =>
                                        intersectsVisibleRange(
                                            segment,
                                            visibleRange
                                        )
                                );
                                const highlightedSegment = findClosestSegment(
                                    visibleSegments.length > 0
                                        ? visibleSegments
                                        : track.segments,
                                    activeTimestamp
                                );

                                return (
                                    <div
                                        key={`${chartDefinition.id}-${track.metricKey}`}
                                        className={styles.track}
                                    >
                                        <div className={styles.trackHeader}>
                                            <div className={styles.trackTitle}>
                                                <span
                                                    className={styles.colorDot}
                                                    style={{
                                                        backgroundColor:
                                                            track.color
                                                    }}
                                                />
                                                <strong>{track.label}</strong>
                                            </div>

                                            <span className={styles.trackMeta}>
                                                {track.valueType ===
                                                "string-list"
                                                    ? "String List"
                                                    : "String"}
                                            </span>
                                        </div>

                                        {visibleSegments.length > 0 ? (
                                            <div className={styles.segmentList}>
                                                {visibleSegments.map(
                                                    (segment) => {
                                                        const segmentStyle = {
                                                            "--segment-accent":
                                                                segment.color
                                                        } as CSSProperties;
                                                        const isActive =
                                                            highlightedSegment?.id ===
                                                            segment.id;

                                                        return (
                                                            <button
                                                                key={segment.id}
                                                                type="button"
                                                                className={`${styles.segment} ${
                                                                    isActive
                                                                        ? styles.segmentActive
                                                                        : ""
                                                                }`}
                                                                style={segmentStyle}
                                                                onClick={() => {
                                                                    const nextRange =
                                                                        buildSegmentFocusRange(
                                                                            {
                                                                                segment,
                                                                                fullRange:
                                                                                    fullTimeDomain,
                                                                                averageSampleInterval
                                                                            }
                                                                        );

                                                                    if (nextRange) {
                                                                        onTimeRangeFocus?.(
                                                                            nextRange
                                                                        );
                                                                    }

                                                                    onTimestampFocus?.(
                                                                        Math.floor(
                                                                            (segment.startTimestamp +
                                                                                segment.endTimestamp) /
                                                                                2
                                                                        )
                                                                    );
                                                                }}
                                                            >
                                                                <div
                                                                    className={
                                                                        styles.segmentHeader
                                                                    }
                                                                >
                                                                    <span
                                                                        className={
                                                                            styles.segmentTime
                                                                        }
                                                                    >
                                                                        {formatTimeRange(
                                                                            segment.startTimestamp,
                                                                            segment.endTimestamp
                                                                        )}
                                                                    </span>
                                                                    <span
                                                                        className={
                                                                            styles.segmentCount
                                                                        }
                                                                    >
                                                                        {
                                                                            segment.sampleCount
                                                                        }{" "}
                                                                        sample{segment.sampleCount === 1 ? "" : "s"}
                                                                    </span>
                                                                </div>

                                                                <strong
                                                                    className={
                                                                        styles.segmentValue
                                                                    }
                                                                >
                                                                    {formatDeepMonitorStateValue(
                                                                        segment.value
                                                                    )}
                                                                </strong>

                                                                <span
                                                                    className={
                                                                        styles.segmentMeta
                                                                    }
                                                                >
                                                                    Duration:{" "}
                                                                    {formatDuration(
                                                                        segment.endTimestamp -
                                                                            segment.startTimestamp
                                                                    )}
                                                                </span>
                                                            </button>
                                                        );
                                                    }
                                                )}
                                            </div>
                                        ) : (
                                            <p className={styles.emptyTrack}>
                                                当前可见时间范围内没有状态样本。
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
}