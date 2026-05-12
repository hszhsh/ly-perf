import type { CpuUsageMode, MetricDatum, MonitorSample } from "@shared/types";
import { MetricChart } from "@renderer/components/MetricChart";
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
    syncGroup
}: MonitorChartsPanelProps) {
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
                    syncGroup={syncGroup}
                    series={FPS_CHART_SERIES}
                />

                <MetricChart
                    title="负载（App CPU / Total CPU / GPU）"
                    samples={samples}
                    syncGroup={syncGroup}
                    series={getLoadChartSeries(activeCpuMode)}
                />

                <MetricChart
                    title="内存细分（MB）"
                    samples={samples}
                    syncGroup={syncGroup}
                    series={MEMORY_CHART_SERIES}
                />

                <MetricChart
                    title="资源吞吐（网络上下行速率 / 磁盘）"
                    samples={samples}
                    syncGroup={syncGroup}
                    series={THROUGHPUT_CHART_SERIES}
                />

                <MetricChart
                    title="温度与功耗"
                    samples={samples}
                    syncGroup={syncGroup}
                    series={THERMAL_POWER_CHART_SERIES}
                />
            </div>
        </>
    );
}
