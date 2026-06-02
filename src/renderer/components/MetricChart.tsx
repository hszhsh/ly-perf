import { useEffect, useMemo, useRef, useState } from "react";
import type { ECharts } from "echarts";
import type {
    MonitorSample,
    SessionTimelineEvent
} from "@shared/types";
import { getTimelineEventTypeLabel } from "@renderer/components/timelineEventPresets";
import { loadEcharts } from "@renderer/utils/loadEcharts";
import { getUiLayerCssValue } from "@renderer/utils/uiLayers";

const CHART_HEIGHT_PX = 280;
const CHART_TOOLTIP_MARGIN_PX = 8;
const CHART_TOOLTIP_MAX_HEIGHT_PX =
    CHART_HEIGHT_PX - CHART_TOOLTIP_MARGIN_PX * 2;
const CHART_TOOLTIP_EXTRA_CSS_TEXT = `z-index:${getUiLayerCssValue("tooltip")};box-shadow:none;`;

export interface TimestampedSample {
    timestamp: number;
}

export interface ChartTimeDomain {
    startTimestamp: number;
    endTimestamp: number;
}

export interface MetricSeries<TSample extends TimestampedSample = MonitorSample> {
    name: string;
    color: string;
    getValue: (sample: TSample) => number | null;
}

export interface ChartFocusRequest {
    id: number;
    timestamp: number;
}

export interface ChartRangeRequest {
    id: number;
    startTimestamp: number;
    endTimestamp: number;
}

function hasPositiveTimeSpan(range: ChartTimeDomain): boolean {
    return range.endTimestamp > range.startTimestamp;
}

interface MetricChartProps<TSample extends TimestampedSample = MonitorSample> {
    title: string;
    samples: TSample[];
    series: MetricSeries<TSample>[];
    timeDomain?: ChartTimeDomain | null;
    events?: SessionTimelineEvent[];
    focusRequest?: ChartFocusRequest | null;
    rangeRequest?: ChartRangeRequest | null;
    onSampleFocus?: (sampleIndex: number) => void;
    onTimestampFocus?: (timestamp: number) => void;
    onAddEventAtTimestamp?: (timestamp: number) => void;
    onVisibleRangeChange?: (startIndex: number, endIndex: number) => void;
    onVisibleTimeRangeChange?: (range: ChartTimeDomain) => void;
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

function getAxisTooltipTimestamp(params: unknown): number | null {
    const axisParams = Array.isArray(params) ? params : [params];
    if (axisParams.length === 0) {
        return null;
    }

    const firstParam = axisParams[0] as {
        axisValue?: number | string;
        value?: [number, unknown] | unknown;
    };
    const axisTimestamp = Array.isArray(firstParam.value)
        ? Number(firstParam.value[0])
        : Number(firstParam.axisValue);

    return Number.isFinite(axisTimestamp) ? axisTimestamp : null;
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
    return `<div style="min-width:260px;max-width:340px;max-height:${CHART_TOOLTIP_MAX_HEIGHT_PX}px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;box-sizing:border-box;padding:14px 14px 12px;border:1px solid rgba(121, 151, 181, 0.28);border-radius:12px;background:linear-gradient(180deg, rgba(18, 28, 42, 0.98), rgba(8, 14, 23, 0.96));box-shadow:0 16px 42px rgba(0, 0, 0, 0.34);backdrop-filter:blur(8px);">${content}</div>`;
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
    samples: TimestampedSample[],
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

function getAverageSampleInterval(samples: TimestampedSample[]): number {
    if (samples.length <= 1) {
        return 1000;
    }

    const firstTimestamp = samples[0]?.timestamp ?? 0;
    const lastTimestamp = samples[samples.length - 1]?.timestamp ?? firstTimestamp;

    return Math.max(1, (lastTimestamp - firstTimestamp) / (samples.length - 1));
}

function findNearestSampleIndex(
    samples: TimestampedSample[],
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
    samples: TimestampedSample[],
    timeDomain?: ChartTimeDomain | null
): { startTimestamp: number; endTimestamp: number } {
    const { startTimestamp: firstTimestamp, endTimestamp: lastTimestamp } =
        getEffectiveTimeDomain(samples, timeDomain);

    if (firstTimestamp >= lastTimestamp) {
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
    samples: TimestampedSample[],
    timeDomain?: ChartTimeDomain | null
): { startIndex: number; endIndex: number } {
    if (samples.length <= 0) {
        return { startIndex: 0, endIndex: 0 };
    }

    const { startTimestamp, endTimestamp } = getVisibleTimeRange(
        chart,
        samples,
        timeDomain
    );
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
    samples: TimestampedSample[]
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
    samples: TimestampedSample[],
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
    samples: TimestampedSample[]
) {
    if (events.length === 0) {
        return [];
    }

    const clusterThreshold = getEventClusterThreshold(samples, events);
    let previousTimestamp = Number.NEGATIVE_INFINITY;
    let lane = 0;

    return events.map((event) => {
        const eventText = event.text.trim() || (event.type === "screenshot" ? "截图" : "");

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
                eventText.length > 18
                    ? `${eventText.slice(0, 18)}...`
                    : eventText,
            eventFullText: eventText,
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
    samples: TimestampedSample[],
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
    samples: TimestampedSample[]
): string {
    const axisParams = Array.isArray(params) ? params : [params];
    if (axisParams.length === 0) {
        return "";
    }

    const axisTimestamp = getAxisTooltipTimestamp(params);
    const relatedEvents = axisTimestamp !== null
        ? getEventsNearTimestamp(events, samples, axisTimestamp)
        : [];
    const sampleLabel = axisTimestamp !== null
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
            title: axisTimestamp !== null
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
                            eventFullText:
                                event.text.trim() ||
                                (event.type === "screenshot" ? "截图" : ""),
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
    samples: TimestampedSample[],
    timestamp: number,
    timeDomain?: ChartTimeDomain | null
): void {
    if (samples.length === 0) {
        return;
    }

    const { startTimestamp: firstTimestamp, endTimestamp: lastTimestamp } =
        getEffectiveTimeDomain(samples, timeDomain);
    const { startTimestamp, endTimestamp } = getVisibleTimeRange(
        chart,
        samples,
        timeDomain
    );

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
    samples: TimestampedSample[],
    timestamp: number,
    timeDomain?: ChartTimeDomain | null
): number | null {
    const sampleIndex = findNearestSampleIndex(samples, timestamp);
    if (sampleIndex < 0) {
        return null;
    }

    const focusedTimestamp = samples[sampleIndex]?.timestamp ?? null;
    if (!Number.isFinite(focusedTimestamp)) {
        return null;
    }

    ensureTimestampVisible(chart, samples, timestamp, timeDomain);
    chart.dispatchAction({
        type: "showTip",
        seriesIndex: 0,
        dataIndex: sampleIndex
    });

    return focusedTimestamp;
}

function normalizeChartTimeDomain(
    timeDomain: ChartTimeDomain | null | undefined
): ChartTimeDomain | null {
    if (!timeDomain) {
        return null;
    }

    const startTimestamp = Number(timeDomain.startTimestamp);
    const endTimestamp = Number(timeDomain.endTimestamp);

    if (
        !Number.isFinite(startTimestamp) ||
        !Number.isFinite(endTimestamp) ||
        endTimestamp <= startTimestamp
    ) {
        return null;
    }

    return {
        startTimestamp: Math.floor(startTimestamp),
        endTimestamp: Math.ceil(endTimestamp)
    };
}

function getEffectiveTimeDomain(
    samples: TimestampedSample[],
    timeDomain?: ChartTimeDomain | null
): ChartTimeDomain {
    const normalizedTimeDomain = normalizeChartTimeDomain(timeDomain);
    if (normalizedTimeDomain) {
        return normalizedTimeDomain;
    }

    const firstTimestamp = samples[0]?.timestamp ?? 0;
    const lastTimestamp = samples[samples.length - 1]?.timestamp ?? firstTimestamp;

    return {
        startTimestamp: firstTimestamp,
        endTimestamp: lastTimestamp
    };
}

function normalizeWheelDeltaY(
    event: WheelEvent,
    referenceHeight: number
): number {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        return event.deltaY * 16;
    }

    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        return event.deltaY * Math.max(referenceHeight, 1);
    }

    return event.deltaY;
}

function canUseVerticalScroll(element: HTMLElement): boolean {
    const computedStyle = window.getComputedStyle(element);
    const overflowY = computedStyle.overflowY || computedStyle.overflow;

    return (
        /(auto|scroll|overlay)/.test(overflowY) &&
        element.scrollHeight > element.clientHeight + 1
    );
}

function canScrollVertically(element: HTMLElement, deltaY: number): boolean {
    const maxScrollTop = element.scrollHeight - element.clientHeight;

    if (maxScrollTop <= 0) {
        return false;
    }

    if (deltaY < 0) {
        return element.scrollTop > 0;
    }

    if (deltaY > 0) {
        return element.scrollTop < maxScrollTop;
    }

    return false;
}

function getVerticalScrollTarget(
    element: HTMLElement,
    deltaY: number
): HTMLElement | null {
    let current: HTMLElement | null = element.parentElement;

    while (current) {
        if (
            canUseVerticalScroll(current) &&
            canScrollVertically(current, deltaY)
        ) {
            return current;
        }

        current = current.parentElement;
    }

    const scrollingElement = document.scrollingElement;

    if (
        scrollingElement instanceof HTMLElement &&
        canUseVerticalScroll(scrollingElement) &&
        canScrollVertically(scrollingElement, deltaY)
    ) {
        return scrollingElement;
    }

    return null;
}

export function getChartTimeDomain(
    ...collections: Array<ReadonlyArray<TimestampedSample> | undefined>
): ChartTimeDomain | null {
    let startTimestamp = Number.POSITIVE_INFINITY;
    let endTimestamp = Number.NEGATIVE_INFINITY;

    for (const collection of collections) {
        for (const item of collection ?? []) {
            if (!Number.isFinite(item.timestamp)) {
                continue;
            }

            startTimestamp = Math.min(startTimestamp, item.timestamp);
            endTimestamp = Math.max(endTimestamp, item.timestamp);
        }
    }

    if (
        !Number.isFinite(startTimestamp) ||
        !Number.isFinite(endTimestamp) ||
        endTimestamp <= startTimestamp
    ) {
        return null;
    }

    return {
        startTimestamp: Math.floor(startTimestamp),
        endTimestamp: Math.ceil(endTimestamp)
    };
}

export function MetricChart<TSample extends TimestampedSample>(
    props: MetricChartProps<TSample>
) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<HTMLDivElement | null>(null);
    const instanceRef = useRef<ECharts | null>(null);
    const suppressedAxisPointerRef = useRef<{
        timestamp: number;
        expiresAt: number;
    } | null>(null);
    const suppressedTimeRangeRef = useRef<ChartTimeDomain | null>(null);
    const lastEmittedTimeRangeRef = useRef<ChartTimeDomain | null>(null);
    const [runtimeState, setRuntimeState] = useState<
        "loading" | "ready" | "error"
    >("loading");
    const normalizedTimeDomain = normalizeChartTimeDomain(props.timeDomain);

    const positionAxisTooltip = (
        point: number | number[],
        params: unknown,
        dom: HTMLElement,
        _rect: unknown,
        size: { contentSize: number[]; viewSize: number[] }
    ): [number, number] => {
        const chart = instanceRef.current;
        const contentWidth = size.contentSize[0] ?? dom.offsetWidth ?? 0;
        const viewWidth =
            size.viewSize[0] ?? wrapperRef.current?.clientWidth ?? contentWidth;
        const axisTimestamp = getAxisTooltipTimestamp(params);
        const axisPixel =
            axisTimestamp === null || !chart
                ? null
                : chart.convertToPixel({ xAxisIndex: 0 }, axisTimestamp);
        const normalizedAxisPixel = Array.isArray(axisPixel)
            ? Number(axisPixel[0])
            : typeof axisPixel === "number"
              ? axisPixel
              : null;
        const fallbackPoint = Array.isArray(point)
            ? point[0]
            : typeof point === "number"
              ? point
              : null;
                const anchorX =
                        normalizedAxisPixel !== null && Number.isFinite(normalizedAxisPixel)
                                ? normalizedAxisPixel
                                : fallbackPoint !== null && Number.isFinite(fallbackPoint)
                                    ? fallbackPoint
                                    : viewWidth / 2;
        const margin = CHART_TOOLTIP_MARGIN_PX;
        const gap = 14;
        const preferredLeft = anchorX + gap;
        const flippedLeft = anchorX - contentWidth - gap;
        const maxLeft = Math.max(margin, viewWidth - contentWidth - margin);
        const left = Math.max(
            margin,
            Math.min(
                maxLeft,
                preferredLeft + contentWidth <= viewWidth - margin
                    ? preferredLeft
                    : flippedLeft
            )
        );

        return [Math.round(left), margin];
    };

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
                item.getValue(sample)
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
                              confine: true,
                              enterable: true,
                              backgroundColor: "transparent",
                              borderWidth: 0,
                              padding: 0,
                              extraCssText: CHART_TOOLTIP_EXTRA_CSS_TEXT,
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
                confine: true,
                enterable: true,
                backgroundColor: "transparent",
                borderWidth: 0,
                padding: 0,
                extraCssText: CHART_TOOLTIP_EXTRA_CSS_TEXT,
                position: positionAxisTooltip,
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
                min: normalizedTimeDomain?.startTimestamp,
                max: normalizedTimeDomain?.endTimestamp,
                boundaryGap: false,
                axisPointer: {
                    snap: true
                },
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
    }, [
        normalizedTimeDomain?.endTimestamp,
        normalizedTimeDomain?.startTimestamp,
        props.events,
        props.samples,
        props.series,
        props.title,
        positionAxisTooltip
    ]);

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

                chart.setOption(option);

                const notifyVisibleRange = () => {
                    const timeRange = getVisibleTimeRange(
                        chart,
                        props.samples,
                        normalizedTimeDomain
                    );
                    const range = getVisibleSampleRange(
                        chart,
                        props.samples,
                        normalizedTimeDomain
                    );
                    props.onVisibleRangeChange?.(
                        range.startIndex,
                        range.endIndex
                    );

                    const normalizedRange = {
                        startTimestamp: Math.floor(timeRange.startTimestamp),
                        endTimestamp: Math.ceil(timeRange.endTimestamp)
                    } satisfies ChartTimeDomain;

                    if (!hasPositiveTimeSpan(normalizedRange)) {
                        return;
                    }

                    const suppressedRange = suppressedTimeRangeRef.current;

                    if (
                        suppressedRange &&
                        Math.abs(
                            suppressedRange.startTimestamp -
                                normalizedRange.startTimestamp
                        ) <= 1 &&
                        Math.abs(
                            suppressedRange.endTimestamp -
                                normalizedRange.endTimestamp
                        ) <= 1
                    ) {
                        suppressedTimeRangeRef.current = null;
                        lastEmittedTimeRangeRef.current = normalizedRange;
                        return;
                    }

                    const previousRange = lastEmittedTimeRangeRef.current;
                    if (
                        previousRange &&
                        previousRange.startTimestamp ===
                            normalizedRange.startTimestamp &&
                        previousRange.endTimestamp === normalizedRange.endTimestamp
                    ) {
                        return;
                    }

                    lastEmittedTimeRangeRef.current = normalizedRange;
                    props.onVisibleTimeRangeChange?.(normalizedRange);
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

                    if (!Number.isFinite(timestamp)) {
                        return;
                    }

                    const suppressedAxisPointer = suppressedAxisPointerRef.current;
                    if (
                        suppressedAxisPointer &&
                        suppressedAxisPointer.expiresAt <= Date.now()
                    ) {
                        suppressedAxisPointerRef.current = null;
                    }

                    if (
                        suppressedAxisPointerRef.current &&
                        Math.abs(
                            timestamp - suppressedAxisPointerRef.current.timestamp
                        ) <= 2
                    ) {
                        suppressedAxisPointerRef.current = null;
                        return;
                    }

                    props.onTimestampFocus?.(Math.floor(timestamp));

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
        normalizedTimeDomain,
        props.onAddEventAtTimestamp,
        props.onSampleFocus,
        props.onTimestampFocus,
        props.onVisibleRangeChange,
        props.onVisibleTimeRangeChange,
        props.samples
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

        const focusedTimestamp = focusChartTimestamp(
            instanceRef.current,
            props.samples,
            props.focusRequest.timestamp,
            normalizedTimeDomain
        );

        if (focusedTimestamp !== null) {
            suppressedAxisPointerRef.current = {
                timestamp: focusedTimestamp,
                expiresAt: Date.now() + 120
            };
        }
    }, [
        normalizedTimeDomain,
        props.focusRequest?.id,
        props.focusRequest?.timestamp,
        props.samples,
        runtimeState
    ]);

    useEffect(() => {
        if (
            runtimeState !== "ready" ||
            !instanceRef.current ||
            !props.rangeRequest ||
            props.samples.length === 0
        ) {
            return;
        }

        const chart = instanceRef.current;
        const currentRange = getVisibleTimeRange(
            chart,
            props.samples,
            normalizedTimeDomain
        );
        const requestedRange = {
            startTimestamp: Math.floor(props.rangeRequest.startTimestamp),
            endTimestamp: Math.ceil(props.rangeRequest.endTimestamp)
        } satisfies ChartTimeDomain;

        if (!hasPositiveTimeSpan(requestedRange)) {
            return;
        }

        if (
            Math.abs(currentRange.startTimestamp - requestedRange.startTimestamp) <=
                1 &&
            Math.abs(currentRange.endTimestamp - requestedRange.endTimestamp) <= 1
        ) {
            return;
        }

        suppressedTimeRangeRef.current = requestedRange;
        chart.dispatchAction({
            type: "dataZoom",
            startValue: requestedRange.startTimestamp,
            endValue: requestedRange.endTimestamp,
            escapeConnect: true
        });
    }, [
        normalizedTimeDomain,
        props.rangeRequest?.endTimestamp,
        props.rangeRequest?.id,
        props.rangeRequest?.startTimestamp,
        props.samples,
        runtimeState
    ]);

    useEffect(() => {
        return () => {
            instanceRef.current?.dispose();
            instanceRef.current = null;
        };
    }, []);

    useEffect(() => {
        const wrapper = wrapperRef.current;

        if (!wrapper) {
            return;
        }

        const handleWheel = (event: WheelEvent) => {
            if (
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                event.shiftKey
            ) {
                return;
            }

            const deltaY = normalizeWheelDeltaY(event, wrapper.clientHeight);

            if (
                !Number.isFinite(deltaY) ||
                deltaY === 0 ||
                Math.abs(deltaY) < Math.abs(event.deltaX)
            ) {
                return;
            }

            const scrollTarget = getVerticalScrollTarget(wrapper, deltaY);

            if (!scrollTarget) {
                return;
            }

            scrollTarget.scrollTop += deltaY;
            event.preventDefault();
        };

        wrapper.addEventListener("wheel", handleWheel, {
            passive: false,
            capture: true
        });

        return () => {
            wrapper.removeEventListener("wheel", handleWheel, true);
        };
    }, []);

    return (
        <div
            ref={wrapperRef}
            style={{
                position: "relative",
                width: "100%",
                minWidth: 0,
                height: `${CHART_HEIGHT_PX}px`,
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
