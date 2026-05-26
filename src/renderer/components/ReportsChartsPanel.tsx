import { useMemo, useState } from "react";
import type {
    DeepMonitorSample,
    SessionDetail,
    SessionTimelineEventInput,
    SessionTimelineEventUpdate
} from "@shared/types";
import {
    getChartTimeDomain,
    MetricChart,
    type ChartFocusRequest,
    type ChartRangeRequest,
    type ChartTimeDomain
} from "@renderer/components/MetricChart";
import { DeepMonitorStateTimelinePanel } from "@renderer/components/DeepMonitorStateTimelinePanel";
import { TimelineEventsPanel } from "@renderer/components/TimelineEventsPanel";
import {
    FPS_CHART_SERIES,
    getCustomChartSeries,
    getDeepMonitorMetricDefinitionMap,
    getLoadChartSeries,
    getSortedCustomChartDefinitions,
    getSortedDeepMonitorSamples,
    MEMORY_CHART_SERIES,
    THERMAL_POWER_CHART_SERIES,
    THROUGHPUT_CHART_SERIES
} from "@renderer/components/metricChartPresets";
import type {
    CustomChartStatsCard,
    VisibleRange,
    VisibleTimeRange
} from "@renderer/hooks/useReportsChartRange";
import {
    formatDecimalValue,
    formatPercentageValue
} from "@renderer/utils/formatters";
import styles from "@renderer/styles/ReportsPage.module.css";

interface LoadChartStatItem {
    label: string;
    stats: {
        min: number;
        max: number;
        average: number;
    } | null;
}

interface ReportsChartsPanelProps {
    sessionDetail: SessionDetail;
    restoredVisibleTimeRange: VisibleTimeRange | null;
    normalizedLoadChartRange: VisibleRange | null;
    loadChartStats: LoadChartStatItem[];
    onSampleFocus: (sampleIndex: number) => void;
    onCustomTimestampFocus: (timestamp: number) => void;
    onVisibleTimeRangeChange: (range: VisibleTimeRange) => void;
    onLoadChartRangeChange: (startIndex: number, endIndex: number) => void;
    customChartRangesById: Record<string, VisibleRange | null>;
    customChartStatsCards: CustomChartStatsCard[];
    onCustomChartRangeChange: (
        chartId: string,
        startIndex: number,
        endIndex: number
    ) => void;
    eventBusyAction: "create" | "update" | "delete" | null;
    eventErrorMessage: string | null;
    onClearEventError: () => void;
    onCreateEvent: (input: SessionTimelineEventInput) => Promise<boolean>;
    onUpdateEvent: (input: SessionTimelineEventUpdate) => Promise<boolean>;
    onDeleteEvent: (eventId: string) => Promise<boolean>;
}

function createRangeRequest(
    range: VisibleTimeRange | null,
    id = 1
): ChartRangeRequest | null {
    if (!range) {
        return null;
    }

    return {
        id,
        startTimestamp: Math.floor(range.startTimestamp),
        endTimestamp: Math.ceil(range.endTimestamp)
    };
}

export function ReportsChartsPanel({
    sessionDetail,
    restoredVisibleTimeRange,
    normalizedLoadChartRange,
    loadChartStats,
    onSampleFocus,
    onCustomTimestampFocus,
    onVisibleTimeRangeChange,
    onLoadChartRangeChange,
    customChartRangesById,
    customChartStatsCards,
    onCustomChartRangeChange,
    eventBusyAction,
    eventErrorMessage,
    onClearEventError,
    onCreateEvent,
    onUpdateEvent,
    onDeleteEvent
}: ReportsChartsPanelProps) {
    const [requestedCreateTimestamp, setRequestedCreateTimestamp] = useState<
        number | null
    >(null);
    const [focusRequest, setFocusRequest] = useState<ChartFocusRequest | null>(
        null
    );
    const [rangeRequest, setRangeRequest] = useState<ChartRangeRequest | null>(
        () => createRangeRequest(restoredVisibleTimeRange)
    );
    const sortedCustomSamples = useMemo(
        () => getSortedDeepMonitorSamples(sessionDetail.customSamples),
        [sessionDetail.customSamples]
    );
    const metricDefinitionMap = useMemo(
        () =>
            getDeepMonitorMetricDefinitionMap(
                sessionDetail.customMetricDefinitions
            ),
        [sessionDetail.customMetricDefinitions]
    );
    const customCharts = useMemo(
        () =>
            getSortedCustomChartDefinitions(sessionDetail.customChartDefinitions)
                .map((chartDefinition) => ({
                    chartDefinition,
                    series: getCustomChartSeries({
                        chartDefinition,
                        metricDefinitionMap
                    })
                }))
                .filter((item) => item.series.length > 0),
        [metricDefinitionMap, sessionDetail.customChartDefinitions]
    );
    const customChartStatsCardMap = useMemo(
        () => new Map(customChartStatsCards.map((card) => [card.chartId, card])),
        [customChartStatsCards]
    );
    const sharedTimeDomain = useMemo(
        () =>
            getChartTimeDomain(
                sessionDetail.samples,
                sortedCustomSamples,
                sessionDetail.events
            ),
        [sessionDetail.events, sessionDetail.samples, sortedCustomSamples]
    );

    function requestFocusTimestamp(timestamp: number): void {
        const normalizedTimestamp = Math.floor(timestamp);

        setFocusRequest((current) => {
            if (current?.timestamp === normalizedTimestamp) {
                return current;
            }

            return {
                id: (current?.id ?? 0) + 1,
                timestamp: normalizedTimestamp
            };
        });
    }

    function requestVisibleTimeRange(range: ChartTimeDomain): void {
        const nextRange = {
            startTimestamp: Math.floor(range.startTimestamp),
            endTimestamp: Math.ceil(range.endTimestamp)
        } satisfies VisibleTimeRange;

        onVisibleTimeRangeChange(nextRange);

        setRangeRequest((current) => {
            if (
                current?.startTimestamp === nextRange.startTimestamp &&
                current.endTimestamp === nextRange.endTimestamp
            ) {
                return current;
            }

            return {
                id: (current?.id ?? 0) + 1,
                startTimestamp: nextRange.startTimestamp,
                endTimestamp: nextRange.endTimestamp
            };
        });
    }

    function handleLocateTimestamp(timestamp: number): void {
        requestFocusTimestamp(timestamp);
    }

    function handleCustomSampleFocus(
        samples: DeepMonitorSample[],
        sampleIndex: number
    ): void {
        const timestamp = samples[sampleIndex]?.timestamp;
        if (typeof timestamp !== "number") {
            return;
        }

        onCustomTimestampFocus(timestamp);
    }

    function formatCustomStatValue(value: number | null, unit: string): string {
        if (value === null) {
            return "N/A";
        }

        return unit
            ? `${formatDecimalValue(value)} ${unit}`
            : formatDecimalValue(value);
    }

    return (
        <section className={styles.chartSection}>
            <div className={styles.sectionHeader}>
                <h4>历史趋势图</h4>
                <span>
                    保留完整采样序列，布局与实时监控一致，缩放区域联动。
                </span>
            </div>

            <div className={styles.chartStack}>
                {sessionDetail.samples.length > 0 ? (
                    <>
                    <MetricChart
                        title="帧率（FPS）"
                        samples={sessionDetail.samples}
                        timeDomain={sharedTimeDomain}
                        events={sessionDetail.events}
                        rangeRequest={rangeRequest}
                        onVisibleTimeRangeChange={requestVisibleTimeRange}
                        onAddEventAtTimestamp={setRequestedCreateTimestamp}
                        onSampleFocus={onSampleFocus}
                        series={FPS_CHART_SERIES}
                    />

                    <MetricChart
                        title="负载（App CPU / Total CPU / GPU）"
                        samples={sessionDetail.samples}
                        timeDomain={sharedTimeDomain}
                        events={sessionDetail.events}
                        rangeRequest={rangeRequest}
                        onVisibleTimeRangeChange={requestVisibleTimeRange}
                        onAddEventAtTimestamp={setRequestedCreateTimestamp}
                        onSampleFocus={onSampleFocus}
                        onVisibleRangeChange={onLoadChartRangeChange}
                        series={getLoadChartSeries(sessionDetail.config.cpuMode)}
                    />

                    <div className={styles.metricStatsPanel}>
                        <div className={styles.metricStatsHeader}>
                            <strong>当前选择区域统计</strong>
                            <span>
                                {normalizedLoadChartRange
                                    ? `样本 ${normalizedLoadChartRange.startIndex + 1} - ${normalizedLoadChartRange.endIndex + 1}`
                                    : "暂无可统计数据"}
                            </span>
                        </div>

                        <div className={styles.metricStatsGrid}>
                            {loadChartStats.map((item) => (
                                <div
                                    key={item.label}
                                    className={styles.metricStatsCard}
                                >
                                    <strong>{item.label}</strong>
                                    <span>
                                        最大值{" "}
                                        {formatPercentageValue(
                                            item.stats?.max ?? null
                                        )}
                                    </span>
                                    <span>
                                        最小值{" "}
                                        {formatPercentageValue(
                                            item.stats?.min ?? null
                                        )}
                                    </span>
                                    <span>
                                        平均值{" "}
                                        {formatPercentageValue(
                                            item.stats?.average ?? null
                                        )}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <MetricChart
                        title="内存细分（MB）"
                        samples={sessionDetail.samples}
                        timeDomain={sharedTimeDomain}
                        events={sessionDetail.events}
                        rangeRequest={rangeRequest}
                        onVisibleTimeRangeChange={requestVisibleTimeRange}
                        onAddEventAtTimestamp={setRequestedCreateTimestamp}
                        onSampleFocus={onSampleFocus}
                        series={MEMORY_CHART_SERIES}
                    />

                    <MetricChart
                        title="资源吞吐（网络上下行速率 / 磁盘）"
                        samples={sessionDetail.samples}
                        timeDomain={sharedTimeDomain}
                        events={sessionDetail.events}
                        rangeRequest={rangeRequest}
                        onVisibleTimeRangeChange={requestVisibleTimeRange}
                        onAddEventAtTimestamp={setRequestedCreateTimestamp}
                        onSampleFocus={onSampleFocus}
                        series={THROUGHPUT_CHART_SERIES}
                    />

                    <MetricChart
                        title="温度与功耗"
                        samples={sessionDetail.samples}
                        timeDomain={sharedTimeDomain}
                        events={sessionDetail.events}
                        rangeRequest={rangeRequest}
                        onVisibleTimeRangeChange={requestVisibleTimeRange}
                        onAddEventAtTimestamp={setRequestedCreateTimestamp}
                        onSampleFocus={onSampleFocus}
                        series={THERMAL_POWER_CHART_SERIES}
                    />

                    {customCharts.map(({ chartDefinition, series }) => {
                        const statsCard = customChartStatsCardMap.get(
                            chartDefinition.id
                        );
                        const chartRange = customChartRangesById[
                            chartDefinition.id
                        ];

                        return (
                            <div key={chartDefinition.id}>
                                <MetricChart
                                    title={chartDefinition.title}
                                    samples={sortedCustomSamples}
                                    timeDomain={sharedTimeDomain}
                                    events={sessionDetail.events}
                                    rangeRequest={rangeRequest}
                                    onVisibleTimeRangeChange={
                                        requestVisibleTimeRange
                                    }
                                    onAddEventAtTimestamp={
                                        setRequestedCreateTimestamp
                                    }
                                    onSampleFocus={(sampleIndex) =>
                                        handleCustomSampleFocus(
                                            sortedCustomSamples,
                                            sampleIndex
                                        )
                                    }
                                    onVisibleRangeChange={(startIndex, endIndex) =>
                                        onCustomChartRangeChange(
                                            chartDefinition.id,
                                            startIndex,
                                            endIndex
                                        )
                                    }
                                    series={series}
                                />

                                {statsCard ? (
                                    <div className={styles.metricStatsPanel}>
                                        <div className={styles.metricStatsHeader}>
                                            <strong>
                                                {chartDefinition.title} 统计
                                            </strong>
                                            <span>
                                                {statsCard.range
                                                    ? `自定义样本 ${statsCard.range.startIndex + 1} - ${statsCard.range.endIndex + 1}`
                                                    : chartRange
                                                      ? `自定义样本 ${chartRange.startIndex + 1} - ${chartRange.endIndex + 1}`
                                                      : "暂无可统计数据"}
                                            </span>
                                        </div>

                                        <div className={styles.metricStatsGrid}>
                                            {statsCard.items.map((item) => (
                                                <div
                                                    key={`${chartDefinition.id}-${item.key}`}
                                                    className={styles.metricStatsCard}
                                                >
                                                    <strong>{item.label}</strong>
                                                    {item.computations.includes(
                                                        "max"
                                                    ) ? (
                                                        <span>
                                                            最大值{" "}
                                                            {formatCustomStatValue(
                                                                item.stats?.max ??
                                                                    null,
                                                                item.unit
                                                            )}
                                                        </span>
                                                    ) : null}
                                                    {item.computations.includes(
                                                        "min"
                                                    ) ? (
                                                        <span>
                                                            最小值{" "}
                                                            {formatCustomStatValue(
                                                                item.stats?.min ??
                                                                    null,
                                                                item.unit
                                                            )}
                                                        </span>
                                                    ) : null}
                                                    {item.computations.includes(
                                                        "average"
                                                    ) ? (
                                                        <span>
                                                            平均值{" "}
                                                            {formatCustomStatValue(
                                                                item.stats?.average ??
                                                                    null,
                                                                item.unit
                                                            )}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}

                    <DeepMonitorStateTimelinePanel
                        metricDefinitions={sessionDetail.customMetricDefinitions ?? []}
                        chartDefinitions={sessionDetail.customChartDefinitions ?? []}
                        samples={sessionDetail.customSamples ?? []}
                        timeDomain={sharedTimeDomain}
                        focusRequest={focusRequest}
                        rangeRequest={rangeRequest}
                        onTimestampFocus={requestFocusTimestamp}
                        onTimeRangeFocus={requestVisibleTimeRange}
                    />
                    </>
                ) : (
                    <p className={styles.empty}>
                        该历史会话暂无采样数据，暂时无法绘制趋势图。
                    </p>
                )}

                <TimelineEventsPanel
                    events={sessionDetail.events}
                    samples={sessionDetail.samples}
                    editable
                    busyAction={eventBusyAction}
                    errorText={eventErrorMessage}
                    requestedCreateTimestamp={requestedCreateTimestamp}
                    onCreateRequestHandled={() =>
                        setRequestedCreateTimestamp(null)
                    }
                    onClearError={onClearEventError}
                    onCreate={onCreateEvent}
                    onUpdate={onUpdateEvent}
                    onDelete={onDeleteEvent}
                    onLocateTimestamp={handleLocateTimestamp}
                />
            </div>
        </section>
    );
}
