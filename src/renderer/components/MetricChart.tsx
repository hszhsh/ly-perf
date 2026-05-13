import { useEffect, useMemo, useRef, useState } from "react";
import type { ECharts } from "echarts";
import type {
    MetricName,
    MonitorSample,
    SessionTimelineEvent
} from "@shared/types";
import { getTimelineEventTypeLabel } from "@renderer/components/timelineEventPresets";
import { loadEcharts } from "@renderer/utils/loadEcharts";

export interface MetricSeries {
    name: string;
    key: MetricName;
    color: string;
}

export interface ChartFocusRequest {
    id: number;
    timestamp: number;
}

interface MetricChartProps {
    title: string;
    samples: MonitorSample[];
    series: MetricSeries[];
    syncGroup?: string;
    events?: SessionTimelineEvent[];
    focusRequest?: ChartFocusRequest | null;
    onSampleFocus?: (sampleIndex: number) => void;
    onAddEventAtTimestamp?: (timestamp: number) => void;
    onVisibleRangeChange?: (startIndex: number, endIndex: number) => void;
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function formatAxisTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${hours}:${minutes}:${seconds}`;
}

function formatTooltipTimestamp(timestamp: number): string {
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

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatTooltipMetricValue(value: unknown): string {
    if (value === null || value === undefined || value === "-") {
        return "N/A";
    }

    if (typeof value === "number") {
        return Number.isFinite(value)
            ? value.toLocaleString(undefined, {
                  maximumFractionDigits: 2
              })
            : "N/A";
    }

    return String(value);
}

function normalizeTooltipColor(color: unknown): string {
    if (Array.isArray(color)) {
        return normalizeTooltipColor(color[0]);
    }

    if (typeof color === "string" && color.trim()) {
        return color;
    }

    return "#7dd3fc";
}

function renderTooltipSurface(content: string): string {
    return `<div style="min-width:260px;max-width:340px;padding:14px 14px 12px;border:1px solid rgba(121, 151, 181, 0.28);border-radius:12px;background:linear-gradient(180deg, rgba(18, 28, 42, 0.98), rgba(8, 14, 23, 0.96));box-shadow:0 16px 42px rgba(0, 0, 0, 0.34);backdrop-filter:blur(8px);">${content}</div>`;
}

function renderTooltipColorDot(color: string, size = 10): string {
    return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:999px;background:${escapeHtml(
        color
    )};box-shadow:0 0 0 1px rgba(255, 255, 255, 0.18) inset;"></span>`;
}

function renderTooltipBadge(label: string, color?: string): string {
    return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid rgba(146, 173, 198, 0.24);background:rgba(21, 33, 47, 0.78);font-size:10px;color:${escapeHtml(
        color ?? "#dbe7f6"
    )};">${escapeHtml(label)}</span>`;
}

function renderTooltipHeader(options: {
    eyebrow?: string;
    title: string;
    meta?: string;
    accentColor?: string;
}): string {
    return [
        '<div style="display:grid;gap:5px;margin-bottom:10px;">',
        options.eyebrow
            ? `<div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8ea1b7;">${escapeHtml(
                  options.eyebrow
              )}</div>`
            : "",
        '<div style="display:flex;align-items:flex-start;gap:8px;min-width:0;">',
        options.accentColor
            ? renderTooltipColorDot(options.accentColor)
            : "",
        `<div style="font-size:13px;font-weight:700;color:#eff6ff;min-width:0;">${escapeHtml(
            options.title
        )}</div>`,
        '</div>',
        options.meta
            ? `<div style="font-size:11px;color:#9fb3cb;">${escapeHtml(
                  options.meta
              )}</div>`
            : "",
        '</div>'
    ].join("");
}

function renderTooltipMetricRow(
    color: string,
    label: string,
    value: string
): string {
    return [
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid rgba(140, 160, 184, 0.1);">',
        '<div style="display:flex;align-items:center;gap:8px;min-width:0;">',
        renderTooltipColorDot(color, 8),
        `<span style="font-size:12px;color:#d7e2ef;min-width:0;">${escapeHtml(
            label
        )}</span>`,
        '</div>',
        `<span style="font-size:12px;font-weight:600;color:#eff6ff;text-align:right;">${escapeHtml(
            value
        )}</span>`,
        '</div>'
    ].join("");
}

function getEventSampleLabel(
    samples: MonitorSample[],
    timestamp: number
): string | undefined {
    const sampleIndex = findNearestSampleIndex(samples, timestamp);

    return sampleIndex >= 0 ? `样本 ${sampleIndex + 1}` : undefined;
}

function renderTooltipEventCard(data: {
    eventColor?: string;
    eventTypeLabel?: string;
    eventTimeLabel?: string;
    eventFullText?: string;
    eventSampleLabel?: string;
}): string {
    const metaParts = [data.eventTimeLabel, data.eventSampleLabel].filter(
        Boolean
    );

    return [
        '<div style="display:grid;gap:8px;padding:10px 12px;border-radius:10px;border:1px solid rgba(116, 145, 171, 0.18);background:rgba(10, 17, 27, 0.7);">',
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap;">',
        '<div style="display:flex;align-items:center;gap:8px;">',
        renderTooltipColorDot(data.eventColor ?? "#7dd3fc", 9),
        renderTooltipBadge(data.eventTypeLabel ?? "事件", data.eventColor),
        '</div>',
        metaParts.length > 0
            ? `<div style="font-size:11px;color:#9fb3cb;">${escapeHtml(
                  metaParts.join(" | ")
              )}</div>`
            : "",
        '</div>',
        `<div style="font-size:12px;line-height:1.5;white-space:pre-wrap;color:#e9f2fd;">${escapeHtml(
            data.eventFullText ?? ""
        )}</div>`,
        '</div>'
    ].join("");
}

function getAverageSampleInterval(samples: MonitorSample[]): number {
    if (samples.length <= 1) {
        return 1000;
    }

    const firstTimestamp = samples[0]?.timestamp ?? 0;
    const lastTimestamp = samples[samples.length - 1]?.timestamp ?? firstTimestamp;

    return Math.max(1, (lastTimestamp - firstTimestamp) / (samples.length - 1));
}

function findNearestSampleIndex(
    samples: MonitorSample[],
    timestamp: number
): number {
    if (samples.length === 0) {
        return -1;
    }

    let low = 0;
    let high = samples.length - 1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const middleTimestamp = samples[middle]?.timestamp ?? 0;

        if (middleTimestamp === timestamp) {
            return middle;
        }

        if (middleTimestamp < timestamp) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    if (low >= samples.length) {
        return samples.length - 1;
    }

    if (high < 0) {
        return 0;
    }

    const nextDistance = Math.abs((samples[low]?.timestamp ?? 0) - timestamp);
    const previousDistance = Math.abs(
        (samples[high]?.timestamp ?? 0) - timestamp
    );

    return previousDistance <= nextDistance ? high : low;
}

function getVisibleTimeRange(
    chart: ECharts,
    samples: MonitorSample[]
): { startTimestamp: number; endTimestamp: number } {
    const firstTimestamp = samples[0]?.timestamp ?? 0;
    const lastTimestamp = samples[samples.length - 1]?.timestamp ?? 0;

    if (samples.length <= 1 || firstTimestamp >= lastTimestamp) {
        return {
            startTimestamp: firstTimestamp,
            endTimestamp: lastTimestamp
        };
    }

    const option = chart.getOption() as {
        dataZoom?: Array<{
            start?: number;
            end?: number;
            startValue?: number | string;
            endValue?: number | string;
        }>;
    };
    const primaryZoom = option.dataZoom?.[0];
    const startValue = Number(primaryZoom?.startValue);
    const endValue = Number(primaryZoom?.endValue);

    if (Number.isFinite(startValue) && Number.isFinite(endValue)) {
        return {
            startTimestamp: Math.max(firstTimestamp, Math.floor(startValue)),
            endTimestamp: Math.min(lastTimestamp, Math.ceil(endValue))
        };
    }

    const startPercent = primaryZoom?.start ?? 0;
    const endPercent = primaryZoom?.end ?? 100;
    const range = lastTimestamp - firstTimestamp;

    return {
        startTimestamp: Math.floor(firstTimestamp + (range * startPercent) / 100),
        endTimestamp: Math.ceil(firstTimestamp + (range * endPercent) / 100)
    };
}

function getVisibleSampleRange(
    chart: ECharts,
    samples: MonitorSample[]
): { startIndex: number; endIndex: number } {
    if (samples.length <= 0) {
        return { startIndex: 0, endIndex: 0 };
    }

    const { startTimestamp, endTimestamp } = getVisibleTimeRange(chart, samples);
    const startIndex = Math.max(
        0,
        findNearestSampleIndex(samples, startTimestamp)
    );
    const endIndex = Math.max(
        startIndex,
        findNearestSampleIndex(samples, endTimestamp)
    );

    return { startIndex, endIndex };
}

function getEventTimestampFromChartClick(
    event: unknown,
    samples: MonitorSample[]
): number | null {
    const markerTimestamp = Number(
        (event as { data?: { xAxis?: number | string } }).data?.xAxis
    );

    if (Number.isFinite(markerTimestamp)) {
        return markerTimestamp;
    }

    const value = (event as { value?: unknown }).value;

    if (Array.isArray(value) && value.length > 0) {
        const timestamp = Number(value[0]);
        return Number.isFinite(timestamp) ? timestamp : null;
    }

    if (typeof value === "number" || typeof value === "string") {
        const timestamp = Number(value);
        return Number.isFinite(timestamp) ? timestamp : null;
    }

    const dataIndex = (event as { dataIndex?: number }).dataIndex;
    if (typeof dataIndex !== "number") {
        return null;
    }

    return samples[dataIndex]?.timestamp ?? null;
}

function getEventClusterThreshold(
    samples: MonitorSample[],
    events: SessionTimelineEvent[]
): number {
    const firstTimestamp =
        samples[0]?.timestamp ?? events[0]?.timestamp ?? Date.now();
    const lastTimestamp =
        samples[samples.length - 1]?.timestamp ??
        events[events.length - 1]?.timestamp ??
        firstTimestamp;
    const totalRange = Math.max(1, lastTimestamp - firstTimestamp);

    return Math.max(getAverageSampleInterval(samples) * 2, totalRange / 18);
}

function buildTimelineMarkerData(
    events: SessionTimelineEvent[],
    samples: MonitorSample[]
) {
    if (events.length === 0) {
        return [];
    }

    const clusterThreshold = getEventClusterThreshold(samples, events);
    let previousTimestamp = Number.NEGATIVE_INFINITY;
    let lane = 0;

    return events.map((event) => {
        if (event.timestamp - previousTimestamp <= clusterThreshold) {
            lane = (lane + 1) % 4;
        } else {
            lane = 0;
        }

        previousTimestamp = event.timestamp;

        const isBottomLane = lane % 2 === 1;
        const laneOffset = Math.floor(lane / 2) * 14;

        return {
            id: event.id,
            xAxis: event.timestamp,
            eventText:
                event.text.length > 18
                    ? `${event.text.slice(0, 18)}...`
                    : event.text,
            eventFullText: event.text,
            eventColor: event.color,
            eventTypeLabel: getTimelineEventTypeLabel(event.type),
            eventTimeLabel: formatTooltipTimestamp(event.timestamp),
            eventSampleLabel: getEventSampleLabel(samples, event.timestamp),
            lineStyle: {
                color: event.color,
                width: 1.5,
                opacity: 0.88
            },
            label: {
                color: event.color,
                position: isBottomLane ? "insideEndBottom" : "insideEndTop",
                distance: 10 + laneOffset,
                backgroundColor: "rgba(11, 18, 28, 0.82)",
                borderRadius: 4,
                padding: [2, 6],
                width: 116,
                overflow: "truncate"
            }
        };
    });
}

function getEventsNearTimestamp(
    events: SessionTimelineEvent[],
    samples: MonitorSample[],
    timestamp: number
): SessionTimelineEvent[] {
    if (events.length === 0) {
        return [];
    }

    const tolerance = Math.max(getAverageSampleInterval(samples) * 0.75, 500);

    return events.filter(
        (event) => Math.abs(event.timestamp - timestamp) <= tolerance
    );
}

function formatAxisTooltip(
    params: unknown,
    events: SessionTimelineEvent[],
    samples: MonitorSample[]
): string {
    const axisParams = Array.isArray(params) ? params : [params];
    if (axisParams.length === 0) {
        return "";
    }

    const firstParam = axisParams[0] as {
        axisValue?: number | string;
        value?: [number, unknown] | unknown;
    };
    const axisTimestamp = Array.isArray(firstParam.value)
        ? Number(firstParam.value[0])
        : Number(firstParam.axisValue);
    const relatedEvents = Number.isFinite(axisTimestamp)
        ? getEventsNearTimestamp(events, samples, axisTimestamp)
        : [];
    const sampleLabel = Number.isFinite(axisTimestamp)
        ? getEventSampleLabel(samples, axisTimestamp)
        : undefined;

    const metricRows: string[] = [];

    for (const item of axisParams as Array<{
        color?: unknown;
        seriesName?: string;
        value?: [number, unknown] | unknown;
    }>) {
        const rawValue = Array.isArray(item.value) ? item.value[1] : item.value;

        metricRows.push(
            renderTooltipMetricRow(
                normalizeTooltipColor(item.color),
                item.seriesName ?? "指标",
                formatTooltipMetricValue(rawValue)
            )
        );
    }

    const sections = [
        renderTooltipHeader({
            eyebrow: "Timeline Sample",
            title: Number.isFinite(axisTimestamp)
                ? formatTooltipTimestamp(axisTimestamp)
                : "当前时间点",
            meta: sampleLabel
        }),
        `<div style="display:grid;gap:0;">${metricRows.join("")}</div>`
    ];

    if (relatedEvents.length > 0) {
        sections.push(
            '<div style="display:grid;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(140, 160, 184, 0.18);">' +
                `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">${renderTooltipBadge(
                    "关联事件"
                )}<span style="font-size:11px;color:#8ea1b7;">${relatedEvents.length} 条</span></div>` +
                relatedEvents
                    .map((event) =>
                        renderTooltipEventCard({
                            eventColor: event.color,
                            eventTypeLabel: getTimelineEventTypeLabel(
                                event.type
                            ),
                            eventTimeLabel: formatTooltipTimestamp(
                                event.timestamp
                            ),
                            eventFullText: event.text,
                            eventSampleLabel: getEventSampleLabel(
                                samples,
                                event.timestamp
                            )
                        })
                    )
                    .join("") +
                '</div>'
        );
    }

    return renderTooltipSurface(sections.join(""));
}

function formatTimelineMarkerTooltip(data: {
    eventColor?: string;
    eventTypeLabel?: string;
    eventTimeLabel?: string;
    eventFullText?: string;
    eventSampleLabel?: string;
}): string {
    return renderTooltipSurface(
        renderTooltipHeader({
            eyebrow: "Timeline Event",
            title: data.eventTypeLabel ?? "事件",
            meta: data.eventTimeLabel,
            accentColor: data.eventColor
        }) +
            renderTooltipEventCard({
                eventColor: data.eventColor,
                eventTypeLabel: data.eventTypeLabel,
                eventTimeLabel: data.eventTimeLabel,
                eventFullText: data.eventFullText,
                eventSampleLabel: data.eventSampleLabel
            })
    );
}

function ensureTimestampVisible(
    chart: ECharts,
    samples: MonitorSample[],
    timestamp: number
): void {
    if (samples.length === 0) {
        return;
    }

    const firstTimestamp = samples[0]?.timestamp ?? timestamp;
    const lastTimestamp = samples[samples.length - 1]?.timestamp ?? timestamp;
    const { startTimestamp, endTimestamp } = getVisibleTimeRange(chart, samples);

    if (timestamp >= startTimestamp && timestamp <= endTimestamp) {
        return;
    }

    const totalRange = Math.max(1, lastTimestamp - firstTimestamp);
    const focusWindow = Math.max(totalRange * 0.18, getAverageSampleInterval(samples) * 10);
    let startValue = Math.floor(timestamp - focusWindow / 2);
    let endValue = Math.ceil(timestamp + focusWindow / 2);

    if (startValue < firstTimestamp) {
        endValue += firstTimestamp - startValue;
        startValue = firstTimestamp;
    }

    if (endValue > lastTimestamp) {
        startValue -= endValue - lastTimestamp;
        endValue = lastTimestamp;
    }

    startValue = Math.max(firstTimestamp, startValue);
    endValue = Math.min(lastTimestamp, Math.max(startValue + 1, endValue));

    chart.dispatchAction({
        type: "dataZoom",
        startValue,
        endValue
    });
}

function focusChartTimestamp(
    chart: ECharts,
    samples: MonitorSample[],
    timestamp: number
): void {
    const sampleIndex = findNearestSampleIndex(samples, timestamp);
    if (sampleIndex < 0) {
        return;
    }

    ensureTimestampVisible(chart, samples, timestamp);
    chart.dispatchAction({
        type: "showTip",
        seriesIndex: 0,
        dataIndex: sampleIndex
    });
}

export function MetricChart(props: MetricChartProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<HTMLDivElement | null>(null);
    const instanceRef = useRef<ECharts | null>(null);
    const [runtimeState, setRuntimeState] = useState<
        "loading" | "ready" | "error"
    >("loading");

    const option = useMemo(() => {
        const timelineEvents = props.events ?? [];
        const markerData = buildTimelineMarkerData(timelineEvents, props.samples);
        const baseSeries = props.series.map((item, seriesIndex) => ({
            type: "line",
            name: item.name,
            showSymbol: false,
            smooth: false,
            itemStyle: {
                color: item.color
            },
            lineStyle: {
                width: 2,
                color: item.color
            },
            data: props.samples.map((sample) => [
                sample.timestamp,
                sample.metrics[item.key]?.value ?? null
            ]),
            markLine:
                seriesIndex === 0 && timelineEvents.length > 0
                    ? {
                          symbol: ["none", "none"],
                          animation: false,
                          precision: 0,
                          z: 5,
                          lineStyle: {
                              width: 1.5
                          },
                          tooltip: {
                              appendToBody: true,
                              confine: true,
                              enterable: true,
                              backgroundColor: "transparent",
                              borderWidth: 0,
                              padding: 0,
                              extraCssText: "box-shadow:none;",
                              formatter: (params: { data?: Record<string, string> }) =>
                                  formatTimelineMarkerTooltip(params.data ?? {})
                          },
                          label: {
                              show: true,
                              position: "insideEndTop",
                              distance: 10,
                              color: "#eff6ff",
                              fontSize: 10,
                              formatter: (
                                  params: {
                                      data?: { eventText?: string };
                                  }
                              ) => params.data?.eventText ?? "事件"
                          },
                          data: markerData
                      }
                    : undefined
        }));

        return {
            backgroundColor: "transparent",
            title: {
                text: props.title,
                textStyle: {
                    color: "#d6dfeb",
                    fontSize: 14,
                    fontFamily: "Bahnschrift, Trebuchet MS, sans-serif"
                },
                left: 8,
                top: 6
            },
            tooltip: {
                trigger: "axis",
                appendToBody: true,
                confine: true,
                enterable: true,
                backgroundColor: "transparent",
                borderWidth: 0,
                padding: 0,
                extraCssText: "box-shadow:none;",
                formatter: (params: unknown) =>
                    formatAxisTooltip(params, timelineEvents, props.samples)
            },
            legend: {
                top: 6,
                right: 10,
                textStyle: {
                    color: "#9fb3cb",
                    fontSize: 11
                }
            },
            grid: {
                left: 50,
                right: 16,
                top: 38,
                bottom: 56
            },
            xAxis: {
                type: "time",
                boundaryGap: false,
                axisLabel: {
                    color: "#8ea1b8",
                    fontSize: 10,
                    formatter: (value: number) => formatAxisTime(Number(value))
                },
                axisLine: {
                    lineStyle: {
                        color: "rgba(118, 145, 171, 0.4)"
                    }
                }
            },
            yAxis: {
                type: "value",
                axisLabel: {
                    color: "#8ea1b8",
                    fontSize: 10
                },
                splitLine: {
                    lineStyle: {
                        color: "rgba(118, 145, 171, 0.18)"
                    }
                }
            },
            dataZoom: [
                {
                    type: "inside",
                    filterMode: "none",
                    zoomOnMouseWheel: "ctrl",
                    moveOnMouseWheel: false
                },
                {
                    type: "slider",
                    filterMode: "none",
                    height: 18,
                    bottom: 12
                }
            ],
            series: baseSeries
        };
    }, [props.events, props.samples, props.series, props.title]);

    useEffect(() => {
        if (!chartRef.current) {
            return;
        }

        let disposed = false;
        let cleanup = () => {};

        void (async () => {
            try {
                const echarts = await loadEcharts();

                if (disposed || !chartRef.current) {
                    return;
                }

                if (!instanceRef.current) {
                    instanceRef.current = echarts.init(chartRef.current);
                }

                const chart = instanceRef.current;

                if (props.syncGroup) {
                    chart.group = props.syncGroup;
                    echarts.connect(props.syncGroup);
                }

                chart.setOption(option);

                const notifyVisibleRange = () => {
                    const range = getVisibleSampleRange(chart, props.samples);
                    props.onVisibleRangeChange?.(
                        range.startIndex,
                        range.endIndex
                    );
                };
                const handleAxisPointerUpdate = (event: unknown) => {
                    const axisInfo = (
                        event as {
                            axesInfo?: Array<{ value?: number | string }>;
                        }
                    ).axesInfo?.[0];
                    const axisValue = axisInfo?.value;
                    const timestamp =
                        typeof axisValue === "number"
                            ? axisValue
                            : Number(axisValue);
                    const sampleIndex = findNearestSampleIndex(
                        props.samples,
                        timestamp
                    );

                    if (
                        !Number.isInteger(sampleIndex) ||
                        sampleIndex < 0 ||
                        sampleIndex >= props.samples.length
                    ) {
                        return;
                    }

                    props.onSampleFocus?.(sampleIndex);
                };
                const handleChartClick = (event: unknown) => {
                    const componentType = (event as { componentType?: string })
                        .componentType;
                    const timestamp = getEventTimestampFromChartClick(
                        event,
                        props.samples
                    );
                    if (timestamp === null) {
                        return;
                    }

                    const sampleIndex = findNearestSampleIndex(
                        props.samples,
                        timestamp
                    );

                    if (sampleIndex >= 0) {
                        props.onSampleFocus?.(sampleIndex);
                    }

                    if (componentType === "markLine") {
                        return;
                    }

                    props.onAddEventAtTimestamp?.(timestamp);
                };
                const resizeChart = () => {
                    const wrapper = wrapperRef.current;

                    if (!wrapper) {
                        chart.resize();
                        return;
                    }

                    chart.resize({
                        width: wrapper.clientWidth,
                        height: wrapper.clientHeight
                    });
                };
                const onResize = () => resizeChart();
                const resizeObserver =
                    typeof ResizeObserver === "undefined"
                        ? null
                        : new ResizeObserver(() => {
                              resizeChart();
                          });

                notifyVisibleRange();
                resizeChart();

                const wrapper = wrapperRef.current;

                if (wrapper) {
                    resizeObserver?.observe(wrapper);
                }

                chart.on("updateAxisPointer", handleAxisPointerUpdate);
                chart.on("click", handleChartClick);
                chart.on("datazoom", notifyVisibleRange);
                window.addEventListener("resize", onResize);

                cleanup = () => {
                    chart.off("updateAxisPointer", handleAxisPointerUpdate);
                    chart.off("click", handleChartClick);
                    chart.off("datazoom", notifyVisibleRange);
                    window.removeEventListener("resize", onResize);
                    resizeObserver?.disconnect();
                };

                setRuntimeState("ready");
            } catch {
                if (!disposed) {
                    setRuntimeState("error");
                }
            }
        })();

        return () => {
            disposed = true;
            cleanup();
        };
    }, [
        option,
        props.onAddEventAtTimestamp,
        props.onSampleFocus,
        props.onVisibleRangeChange,
        props.samples,
        props.syncGroup
    ]);

    useEffect(() => {
        if (
            runtimeState !== "ready" ||
            !instanceRef.current ||
            !props.focusRequest ||
            props.samples.length === 0
        ) {
            return;
        }

        focusChartTimestamp(
            instanceRef.current,
            props.samples,
            props.focusRequest.timestamp
        );
    }, [
        props.focusRequest?.id,
        props.focusRequest?.timestamp,
        props.samples,
        runtimeState
    ]);

    useEffect(() => {
        return () => {
            instanceRef.current?.dispose();
            instanceRef.current = null;
        };
    }, []);

    return (
        <div
            ref={wrapperRef}
            style={{
                position: "relative",
                width: "100%",
                minWidth: 0,
                height: "280px",
                overflow: "hidden"
            }}
        >
            <div
                ref={chartRef}
                style={{
                    width: "100%",
                    minWidth: 0,
                    height: "100%",
                    opacity: runtimeState === "ready" ? 1 : 0
                }}
            />
            {runtimeState !== "ready" ? (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#9fb3cb",
                        fontSize: "12px"
                    }}
                >
                    {runtimeState === "error"
                        ? "图表加载失败"
                        : "图表加载中..."}
                </div>
            ) : null}
        </div>
    );
}
