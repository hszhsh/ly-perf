import { useState } from "react";
import type {
    CpuUsageMode,
    MetricDatum,
    MonitorSample,
    SessionTimelineEvent,
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
import { formatDecimalValue } from "@renderer/utils/formatters";
import styles from "@renderer/styles/MonitorPage.module.css";

interface MonitorChartsPanelProps {
    samples: MonitorSample[];
    activeCpuMode: CpuUsageMode;
    latestNetworkRx?: MetricDatum;
    latestNetworkTx?: MetricDatum;
    latestNetworkTotal?: MetricDatum;
    syncGroup: string;
    events: SessionTimelineEvent[];
    editableEvents: boolean;
    eventBusyAction: "create" | "update" | "delete" | null;
    eventErrorMessage: string;
    onClearEventError: () => void;
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
    latestNetworkRx,
    latestNetworkTx,
    latestNetworkTotal,
    syncGroup,
    events,
    editableEvents,
    eventBusyAction,
    eventErrorMessage,
    onClearEventError,
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

    function handleLocateTimestamp(timestamp: number): void {
        setFocusRequest((current) => ({
            id: (current?.id ?? 0) + 1,
            timestamp
        }));
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
                    events={events}
                    focusRequest={focusRequest}
                    syncGroup={syncGroup}
                    onAddEventAtTimestamp={
                        editableEvents ? setRequestedCreateTimestamp : undefined
                    }
                    series={FPS_CHART_SERIES}
                />

                <MetricChart
                    title="负载（App CPU / Total CPU / GPU）"
                    samples={samples}
                    events={events}
                    focusRequest={focusRequest}
                    syncGroup={syncGroup}
                    onAddEventAtTimestamp={
                        editableEvents ? setRequestedCreateTimestamp : undefined
                    }
                    series={getLoadChartSeries(activeCpuMode)}
                />

                <MetricChart
                    title="内存细分（MB）"
                    samples={samples}
                    events={events}
                    focusRequest={focusRequest}
                    syncGroup={syncGroup}
                    onAddEventAtTimestamp={
                        editableEvents ? setRequestedCreateTimestamp : undefined
                    }
                    series={MEMORY_CHART_SERIES}
                />

                <MetricChart
                    title="资源吞吐（网络上下行速率 / 磁盘）"
                    samples={samples}
                    events={events}
                    focusRequest={focusRequest}
                    syncGroup={syncGroup}
                    onAddEventAtTimestamp={
                        editableEvents ? setRequestedCreateTimestamp : undefined
                    }
                    series={THROUGHPUT_CHART_SERIES}
                />

                <MetricChart
                    title="温度与功耗"
                    samples={samples}
                    events={events}
                    focusRequest={focusRequest}
                    syncGroup={syncGroup}
                    onAddEventAtTimestamp={
                        editableEvents ? setRequestedCreateTimestamp : undefined
                    }
                    series={THERMAL_POWER_CHART_SERIES}
                />

                <TimelineEventsPanel
                    events={events}
                    samples={samples}
                    editable={editableEvents}
                    busyAction={eventBusyAction}
                    errorText={eventErrorMessage || null}
                    requestedCreateTimestamp={requestedCreateTimestamp}
                    onCreateRequestHandled={() => setRequestedCreateTimestamp(null)}
                    onClearError={onClearEventError}
                    onCreate={onCreateEvent}
                    onUpdate={onUpdateEvent}
                    onDelete={onDeleteEvent}
                    onLocateTimestamp={handleLocateTimestamp}
                />
            </div>
        </>
    );
}
