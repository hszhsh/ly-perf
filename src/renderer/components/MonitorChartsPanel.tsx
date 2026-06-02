import { useMemo, useState } from "react";
import type {
    CpuUsageMode,
    DeepMonitorChartDefinition,
    DeepMonitorMetricDefinition,
    DeepMonitorSample,
    MetricDatum,
    MonitorSample,
    SessionTimelineEvent,
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
import { formatDecimalValue } from "@renderer/utils/formatters";
import styles from "@renderer/styles/MonitorPage.module.css";

interface MonitorChartsPanelProps {
    samples: MonitorSample[];
    activeCpuMode: CpuUsageMode;
    customMetricDefinitions: DeepMonitorMetricDefinition[];
    customChartDefinitions: DeepMonitorChartDefinition[];
    customSamples: DeepMonitorSample[];
    latestNetworkRx?: MetricDatum;
    latestNetworkTx?: MetricDatum;
    latestNetworkTotal?: MetricDatum;
    events: SessionTimelineEvent[];
    editableEvents: boolean;
    eventBusyAction: "capture" | "create" | "update" | "delete" | null;
    eventErrorMessage: string;
    onClearEventError: () => void;
    onCaptureScreenshotEvent: () => Promise<boolean>;
    onCreateEvent: (input: SessionTimelineEventInput) => Promise<boolean>;
    onUpdateEvent: (input: SessionTimelineEventUpdate) => Promise<boolean>;
    onDeleteEvent: (eventId: string) => Promise<boolean>;
}

function formatMetric(metric: MetricDatum | undefined): string {
    if (!metric?.available || metric.value === null) {
        return "N/A";
    }

    return `${formatDecimalValue(metric.value)} ${metric.unit}`;
}

function formatTraffic(metric: MetricDatum | undefined): string {
    if (!metric?.available || metric.value === null) {
        return "N/A";
    }

    if (metric.unit === "MB" && metric.value >= 1024) {
        return `${formatDecimalValue(metric.value / 1024)} GB`;
    }

    return `${formatDecimalValue(metric.value)} ${metric.unit}`;
}

export function MonitorChartsPanel({
    samples,
    activeCpuMode,
    customMetricDefinitions,
    customChartDefinitions,
    customSamples,
    latestNetworkRx,
    latestNetworkTx,
    latestNetworkTotal,
    events,
    editableEvents,
    eventBusyAction,
    eventErrorMessage,
    onClearEventError,
    onCaptureScreenshotEvent,
    onCreateEvent,
    onUpdateEvent,
    onDeleteEvent
}: MonitorChartsPanelProps) {
    const [requestedCreateTimestamp, setRequestedCreateTimestamp] = useState<
        number | null
    >(null);
    const [focusRequest, setFocusRequest] = useState<ChartFocusRequest | null>(
        null
    );
    const [rangeRequest, setRangeRequest] = useState<ChartRangeRequest | null>(
        null
    );
    const metricDefinitionMap = getDeepMonitorMetricDefinitionMap(
        customMetricDefinitions
    );
    const sortedCustomSamples = getSortedDeepMonitorSamples(customSamples);
    const sortedCustomCharts = getSortedCustomChartDefinitions(
        customChartDefinitions
    );
    const loadChartSeries = useMemo(
        () => getLoadChartSeries(activeCpuMode),
        [activeCpuMode]
    );
    const sharedTimeDomain = getChartTimeDomain(
        samples,
        sortedCustomSamples,
        events
    );

    function requestFocusTimestamp(timestamp: number): void {
        const normalizedTimestamp = Math.floor(timestamp);

        setFocusRequest((current) => ({
            id: (current?.id ?? 0) + 1,
            timestamp: normalizedTimestamp
        }));
    }

    function requestVisibleTimeRange(range: ChartTimeDomain): void {
        const startTimestamp = Math.floor(range.startTimestamp);
        const endTimestamp = Math.ceil(range.endTimestamp);

        if (endTimestamp <= startTimestamp) {
            return;
        }

        setRangeRequest((current) => {
            if (
                current?.startTimestamp === startTimestamp &&
                current.endTimestamp === endTimestamp
            ) {
                return current;
            }

            return {
                id: (current?.id ?? 0) + 1,
                startTimestamp,
                endTimestamp
            };
        });
    }

    function handleLocateTimestamp(timestamp: number): void {
        requestFocusTimestamp(timestamp);
    }

    return (
        <>
            <section className={styles.networkSummary}>
                <div className={styles.summaryCard}>
                    <span>下行速率</span>
                    <strong>{formatMetric(latestNetworkRx)}</strong>
                    <small>当前采样窗口下载速率</small>
                </div>
                <div className={styles.summaryCard}>
                    <span>上行速率</span>
                    <strong>{formatMetric(latestNetworkTx)}</strong>
                    <small>当前采样窗口上传速率</small>
                </div>
                <div className={styles.summaryCard}>
                    <span>会话总流量</span>
                    <strong>{formatTraffic(latestNetworkTotal)}</strong>
                    <small>从本次监控启动开始累计</small>
                </div>
            </section>

            <div className={styles.charts}>
                <MetricChart
                    title="帧率（FPS）"
                    samples={samples}
                    timeDomain={sharedTimeDomain}
                    events={events}
                    focusRequest={focusRequest}
                    rangeRequest={rangeRequest}
                    onVisibleTimeRangeChange={requestVisibleTimeRange}
                    onAddEventAtTimestamp={
                        editableEvents ? setRequestedCreateTimestamp : undefined
                    }
                    series={FPS_CHART_SERIES}
                />

                <MetricChart
                    title="负载（App CPU / Total CPU / GPU）"
                    samples={samples}
                    timeDomain={sharedTimeDomain}
                    events={events}
                    focusRequest={focusRequest}
                    rangeRequest={rangeRequest}
                    onVisibleTimeRangeChange={requestVisibleTimeRange}
                    onAddEventAtTimestamp={
                        editableEvents ? setRequestedCreateTimestamp : undefined
                    }
                    series={loadChartSeries}
                />

                <MetricChart
                    title="内存细分（MB）"
                    samples={samples}
                    timeDomain={sharedTimeDomain}
                    events={events}
                    focusRequest={focusRequest}
                    rangeRequest={rangeRequest}
                    onVisibleTimeRangeChange={requestVisibleTimeRange}
                    onAddEventAtTimestamp={
                        editableEvents ? setRequestedCreateTimestamp : undefined
                    }
                    series={MEMORY_CHART_SERIES}
                />

                <MetricChart
                    title="资源吞吐（网络上下行速率 / 磁盘）"
                    samples={samples}
                    timeDomain={sharedTimeDomain}
                    events={events}
                    focusRequest={focusRequest}
                    rangeRequest={rangeRequest}
                    onVisibleTimeRangeChange={requestVisibleTimeRange}
                    onAddEventAtTimestamp={
                        editableEvents ? setRequestedCreateTimestamp : undefined
                    }
                    series={THROUGHPUT_CHART_SERIES}
                />

                <MetricChart
                    title="温度与功耗"
                    samples={samples}
                    timeDomain={sharedTimeDomain}
                    events={events}
                    focusRequest={focusRequest}
                    rangeRequest={rangeRequest}
                    onVisibleTimeRangeChange={requestVisibleTimeRange}
                    onAddEventAtTimestamp={
                        editableEvents ? setRequestedCreateTimestamp : undefined
                    }
                    series={THERMAL_POWER_CHART_SERIES}
                />

                {sortedCustomCharts.map((chartDefinition) => {
                    const series = getCustomChartSeries({
                        chartDefinition,
                        metricDefinitionMap
                    });

                    if (series.length === 0) {
                        return null;
                    }

                    return (
                        <MetricChart
                            key={chartDefinition.id}
                            title={chartDefinition.title}
                            samples={sortedCustomSamples}
                            timeDomain={sharedTimeDomain}
                            events={events}
                            focusRequest={focusRequest}
                            rangeRequest={rangeRequest}
                            onVisibleTimeRangeChange={
                                requestVisibleTimeRange
                            }
                            onAddEventAtTimestamp={
                                editableEvents
                                    ? setRequestedCreateTimestamp
                                    : undefined
                            }
                            series={series}
                        />
                    );
                })}

                <DeepMonitorStateTimelinePanel
                    metricDefinitions={customMetricDefinitions}
                    chartDefinitions={customChartDefinitions}
                    samples={customSamples}
                    timeDomain={sharedTimeDomain}
                    focusRequest={focusRequest}
                    rangeRequest={rangeRequest}
                    onTimestampFocus={requestFocusTimestamp}
                    onTimeRangeFocus={requestVisibleTimeRange}
                />

                <TimelineEventsPanel
                    events={events}
                    samples={samples}
                    canCreate={editableEvents}
                    canModify={editableEvents}
                    busyAction={eventBusyAction}
                    errorText={eventErrorMessage || null}
                    requestedCreateTimestamp={requestedCreateTimestamp}
                    onCreateRequestHandled={() => setRequestedCreateTimestamp(null)}
                    onClearError={onClearEventError}
                    onCaptureScreenshot={onCaptureScreenshotEvent}
                    onCreate={onCreateEvent}
                    onUpdate={onUpdateEvent}
                    onDelete={onDeleteEvent}
                    onLocateTimestamp={handleLocateTimestamp}
                />
            </div>
        </>
    );
}
