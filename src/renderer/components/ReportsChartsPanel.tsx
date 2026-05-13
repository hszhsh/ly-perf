import { useState } from "react";
import type {
    SessionDetail,
    SessionTimelineEventInput,
    SessionTimelineEventUpdate
} from "@shared/types";
import {
    MetricChart,
    type ChartFocusRequest
} from "@renderer/components/MetricChart";
import { TimelineEventsPanel } from "@renderer/components/TimelineEventsPanel";
import {
    FPS_CHART_SERIES,
    getLoadChartSeries,
    MEMORY_CHART_SERIES,
    THERMAL_POWER_CHART_SERIES,
    THROUGHPUT_CHART_SERIES
} from "@renderer/components/metricChartPresets";
import { formatPercentageValue } from "@renderer/utils/formatters";
import styles from "@renderer/styles/ReportsPage.module.css";

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

interface ReportsChartsPanelProps {
    sessionDetail: SessionDetail;
    chartSyncGroup?: string;
    normalizedLoadChartRange: VisibleRange | null;
    loadChartStats: LoadChartStatItem[];
    onSampleFocus: (sampleIndex: number) => void;
    onLoadChartRangeChange: (startIndex: number, endIndex: number) => void;
    eventBusyAction: "create" | "update" | "delete" | null;
    eventErrorMessage: string | null;
    onClearEventError: () => void;
    onCreateEvent: (input: SessionTimelineEventInput) => Promise<boolean>;
    onUpdateEvent: (input: SessionTimelineEventUpdate) => Promise<boolean>;
    onDeleteEvent: (eventId: string) => Promise<boolean>;
}

export function ReportsChartsPanel({
    sessionDetail,
    chartSyncGroup,
    normalizedLoadChartRange,
    loadChartStats,
    onSampleFocus,
    onLoadChartRangeChange,
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

    function handleLocateTimestamp(timestamp: number): void {
        setFocusRequest((current) => ({
            id: (current?.id ?? 0) + 1,
            timestamp
        }));
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
                        events={sessionDetail.events}
                        focusRequest={focusRequest}
                        syncGroup={chartSyncGroup}
                        onAddEventAtTimestamp={setRequestedCreateTimestamp}
                        onSampleFocus={onSampleFocus}
                        series={FPS_CHART_SERIES}
                    />

                    <MetricChart
                        title="负载（App CPU / Total CPU / GPU）"
                        samples={sessionDetail.samples}
                        events={sessionDetail.events}
                        focusRequest={focusRequest}
                        syncGroup={chartSyncGroup}
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
                        events={sessionDetail.events}
                        focusRequest={focusRequest}
                        syncGroup={chartSyncGroup}
                        onAddEventAtTimestamp={setRequestedCreateTimestamp}
                        onSampleFocus={onSampleFocus}
                        series={MEMORY_CHART_SERIES}
                    />

                    <MetricChart
                        title="资源吞吐（网络上下行速率 / 磁盘）"
                        samples={sessionDetail.samples}
                        events={sessionDetail.events}
                        focusRequest={focusRequest}
                        syncGroup={chartSyncGroup}
                        onAddEventAtTimestamp={setRequestedCreateTimestamp}
                        onSampleFocus={onSampleFocus}
                        series={THROUGHPUT_CHART_SERIES}
                    />

                    <MetricChart
                        title="温度与功耗"
                        samples={sessionDetail.samples}
                        events={sessionDetail.events}
                        focusRequest={focusRequest}
                        syncGroup={chartSyncGroup}
                        onAddEventAtTimestamp={setRequestedCreateTimestamp}
                        onSampleFocus={onSampleFocus}
                        series={THERMAL_POWER_CHART_SERIES}
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
