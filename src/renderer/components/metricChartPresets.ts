import type {
    CpuUsageMode,
    DeepMonitorChartDefinition,
    DeepMonitorMetricDefinition,
    DeepMonitorSample,
    DeepMonitorSampleValue,
    DeepMonitorValueType
} from "@shared/types";
import type { MetricSeries } from "@renderer/components/MetricChart";

const CUSTOM_CHART_FALLBACK_COLORS = [
    "#4dd0e1",
    "#ff8a65",
    "#7bd389",
    "#ffd54f",
    "#9575cd",
    "#f06292",
    "#64b5f6",
    "#90a4ae"
];

type DeepMonitorStateValueType = Exclude<DeepMonitorValueType, "number">;

export interface DeepMonitorStateSegment {
    id: string;
    metricKey: string;
    label: string;
    color: string;
    value: string | string[] | null;
    formattedValue: string;
    valueKey: string;
    startTimestamp: number;
    endTimestamp: number;
    sampleCount: number;
}

export interface DeepMonitorStateTrack {
    metricKey: string;
    label: string;
    color: string;
    valueType: DeepMonitorStateValueType;
    segments: DeepMonitorStateSegment[];
}

export interface DeepMonitorStateChart {
    chartDefinition: DeepMonitorChartDefinition;
    tracks: DeepMonitorStateTrack[];
}

function getMedian(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }

    const sortedValues = [...values].sort((left, right) => left - right);
    const middleIndex = Math.floor(sortedValues.length / 2);

    if (sortedValues.length % 2 === 1) {
        return sortedValues[middleIndex] ?? null;
    }

    const leftValue = sortedValues[middleIndex - 1];
    const rightValue = sortedValues[middleIndex];

    if (leftValue === undefined || rightValue === undefined) {
        return null;
    }

    return (leftValue + rightValue) / 2;
}

function getDeepMonitorDisplayTimestampOffset(
    samples: DeepMonitorSample[]
): number | null {
    const minimumBatchOffsetsByReceivedAt = new Map<number, number>();

    for (const sample of samples) {
        if (
            !Number.isFinite(sample.timestamp) ||
            !Number.isFinite(sample.receivedAt)
        ) {
            continue;
        }

        const offset = sample.receivedAt - sample.timestamp;
        const previousOffset = minimumBatchOffsetsByReceivedAt.get(
            sample.receivedAt
        );

        if (previousOffset === undefined || offset < previousOffset) {
            minimumBatchOffsetsByReceivedAt.set(sample.receivedAt, offset);
        }
    }

    const medianOffset = getMedian([
        ...minimumBatchOffsetsByReceivedAt.values()
    ]);

    return medianOffset === null ? null : Math.round(medianOffset);
}

export function getDeepMonitorMetricDefinitionMap(
    definitions: DeepMonitorMetricDefinition[] | undefined
): Map<string, DeepMonitorMetricDefinition> {
    return new Map((definitions ?? []).map((definition) => [definition.key, definition]));
}

function isStringListValue(
    value: DeepMonitorSampleValue | undefined
): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStateSampleValue(
    value: DeepMonitorSampleValue | undefined
): value is string | string[] | null {
    return value === null || typeof value === "string" || isStringListValue(value);
}

function getStateValueKey(value: string | string[] | null): string {
    if (value === null) {
        return "null";
    }

    if (typeof value === "string") {
        return `string:${value}`;
    }

    return `string-list:${JSON.stringify(value)}`;
}

export function formatDeepMonitorStateValue(
    value: string | string[] | null
): string {
    if (value === null) {
        return "N/A";
    }

    if (typeof value === "string") {
        return value.length > 0 ? value : "(empty)";
    }

    return value.length > 0 ? value.join(", ") : "(empty list)";
}

export function getCustomChartValueType(params: {
    chartDefinition: DeepMonitorChartDefinition;
    metricDefinitionMap: Map<string, DeepMonitorMetricDefinition>;
}): DeepMonitorValueType | null {
    const { chartDefinition, metricDefinitionMap } = params;
    const firstMetricKey = chartDefinition.metricKeys[0];

    if (!firstMetricKey) {
        return null;
    }

    return metricDefinitionMap.get(firstMetricKey)?.valueType ?? null;
}

export function isNumericCustomChartDefinition(params: {
    chartDefinition: DeepMonitorChartDefinition;
    metricDefinitionMap: Map<string, DeepMonitorMetricDefinition>;
}): boolean {
    return getCustomChartValueType(params) === "number";
}

function buildStateTrack(params: {
    chartDefinition: DeepMonitorChartDefinition;
    metricKey: string;
    metricDefinitionMap: Map<string, DeepMonitorMetricDefinition>;
    samples: DeepMonitorSample[];
    index: number;
}): DeepMonitorStateTrack | null {
    const {
        chartDefinition,
        metricKey,
        metricDefinitionMap,
        samples,
        index
    } = params;
    const definition = metricDefinitionMap.get(metricKey);
    const valueType = definition?.valueType;

    if (valueType !== "string" && valueType !== "string-list") {
        return null;
    }

    const color =
        definition?.color ??
        CUSTOM_CHART_FALLBACK_COLORS[index % CUSTOM_CHART_FALLBACK_COLORS.length];
    const segments: DeepMonitorStateSegment[] = [];
    let currentSegment: DeepMonitorStateSegment | null = null;

    for (const sample of samples) {
        const rawValue = sample.values[metricKey];

        if (!isStateSampleValue(rawValue)) {
            currentSegment = null;
            continue;
        }

        const value = Array.isArray(rawValue) ? [...rawValue] : rawValue;
        const valueKey = getStateValueKey(value);

        if (currentSegment && currentSegment.valueKey === valueKey) {
            currentSegment.endTimestamp = sample.timestamp;
            currentSegment.sampleCount += 1;
            continue;
        }

        currentSegment = {
            id: `${chartDefinition.id}:${metricKey}:${sample.timestamp}:${segments.length}`,
            metricKey,
            label: definition?.label ?? metricKey,
            color,
            value,
            formattedValue: formatDeepMonitorStateValue(value),
            valueKey,
            startTimestamp: sample.timestamp,
            endTimestamp: sample.timestamp,
            sampleCount: 1
        };
        segments.push(currentSegment);
    }

    if (segments.length === 0) {
        return null;
    }

    return {
        metricKey,
        label: definition?.label ?? metricKey,
        color,
        valueType,
        segments
    };
}

export function getCustomStateCharts(params: {
    chartDefinitions: DeepMonitorChartDefinition[] | undefined;
    metricDefinitionMap: Map<string, DeepMonitorMetricDefinition>;
    samples: DeepMonitorSample[];
}): DeepMonitorStateChart[] {
    const { chartDefinitions, metricDefinitionMap, samples } = params;

    return (chartDefinitions ?? [])
        .filter(
            (chartDefinition) =>
                getCustomChartValueType({
                    chartDefinition,
                    metricDefinitionMap
                }) !== "number"
        )
        .map((chartDefinition) => ({
            chartDefinition,
            tracks: chartDefinition.metricKeys
                .map((metricKey, index) =>
                    buildStateTrack({
                        chartDefinition,
                        metricKey,
                        metricDefinitionMap,
                        samples,
                        index
                    })
                )
                .filter((track): track is DeepMonitorStateTrack => track !== null)
        }))
        .filter((chart): chart is DeepMonitorStateChart => chart.tracks.length > 0);
}

export function getSortedCustomChartDefinitions(
    definitions: DeepMonitorChartDefinition[] | undefined
): DeepMonitorChartDefinition[] {
    return [...(definitions ?? [])]
        .filter((definition) => definition.metricKeys.length > 0)
        .sort((left, right) => {
            const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;

            if (leftOrder !== rightOrder) {
                return leftOrder - rightOrder;
            }

            return left.title.localeCompare(right.title, "zh-CN");
        });
}

export function getSortedDeepMonitorSamples(
    samples: DeepMonitorSample[] | undefined
): DeepMonitorSample[] {
    const sortedSamples = [...(samples ?? [])].sort((left, right) => {
        if (left.timestamp !== right.timestamp) {
            return left.timestamp - right.timestamp;
        }

        if (left.receivedAt !== right.receivedAt) {
            return left.receivedAt - right.receivedAt;
        }

        return (left.sequence ?? 0) - (right.sequence ?? 0);
    });

    const displayTimestampOffset = getDeepMonitorDisplayTimestampOffset(
        sortedSamples
    );

    if (displayTimestampOffset === null || displayTimestampOffset === 0) {
        return sortedSamples;
    }

    return sortedSamples.map((sample) => ({
        ...sample,
        timestamp: Math.floor(sample.timestamp + displayTimestampOffset)
    }));
}

export function getCustomChartSeries(params: {
    chartDefinition: DeepMonitorChartDefinition;
    metricDefinitionMap: Map<string, DeepMonitorMetricDefinition>;
}): MetricSeries<DeepMonitorSample>[] {
    const { chartDefinition, metricDefinitionMap } = params;

    if (
        !isNumericCustomChartDefinition({
            chartDefinition,
            metricDefinitionMap
        })
    ) {
        return [];
    }

    return chartDefinition.metricKeys.map((metricKey, index) => {
        const definition = metricDefinitionMap.get(metricKey);

        return {
            name: definition?.label ?? metricKey,
            color:
                definition?.color ??
                CUSTOM_CHART_FALLBACK_COLORS[
                    index % CUSTOM_CHART_FALLBACK_COLORS.length
                ],
            getValue: (sample) => {
                const value = sample.values[metricKey];
                return typeof value === "number" && Number.isFinite(value)
                    ? value
                    : value === null
                      ? null
                      : null;
            }
        };
    });
}

export const FPS_CHART_SERIES: MetricSeries[] = [
    {
        name: "FPS",
        color: "#e24a6e",
        getValue: (sample) => sample.metrics.fps?.value ?? null
    },
    {
        name: "Jank",
        color: "#f4b860",
        getValue: (sample) => sample.metrics.jank?.value ?? null
    },
    {
        name: "Big Jank",
        color: "#ff7a59",
        getValue: (sample) => sample.metrics.bigJank?.value ?? null
    }
];

export function getLoadChartSeries(
    cpuMode: CpuUsageMode | undefined
): MetricSeries[] {
    return [
        {
            name:
                cpuMode === "normalized"
                    ? "App CPU Norm.(%)"
                    : "App CPU(%)",
            color: "#5ca6ff",
            getValue: (sample) => sample.metrics.cpu?.value ?? null
        },
        {
            name:
                cpuMode === "normalized"
                    ? "Total CPU Norm.(%)"
                    : "Total CPU(%)",
            color: "#59d6d6",
            getValue: (sample) => sample.metrics.cpuTotal?.value ?? null
        },
        {
            name: "GPU(%)",
            color: "#7bd389",
            getValue: (sample) => sample.metrics.gpu?.value ?? null
        }
    ];
}

export const MEMORY_CHART_SERIES: MetricSeries[] = [
    {
        name: "PSS Total",
        color: "#f4b860",
        getValue: (sample) => sample.metrics.memory?.value ?? null
    },
    {
        name: "Graphics",
        color: "#4fc3f7",
        getValue: (sample) => sample.metrics.memoryGraphics?.value ?? null
    },
    {
        name: "Native Heap",
        color: "#81c784",
        getValue: (sample) => sample.metrics.memoryNativeHeap?.value ?? null
    },
    {
        name: "Private Other",
        color: "#ff8a65",
        getValue: (sample) => sample.metrics.memoryPrivateOther?.value ?? null
    }
];

export const THROUGHPUT_CHART_SERIES: MetricSeries[] = [
    {
        name: "下行 KB/s",
        color: "#4dd0e1",
        getValue: (sample) => sample.metrics.networkRx?.value ?? null
    },
    {
        name: "上行 KB/s",
        color: "#26a69a",
        getValue: (sample) => sample.metrics.networkTx?.value ?? null
    },
    {
        name: "Disk Read",
        color: "#ab47bc",
        getValue: (sample) => sample.metrics.diskRead?.value ?? null
    },
    {
        name: "Disk Write",
        color: "#7e57c2",
        getValue: (sample) => sample.metrics.diskWrite?.value ?? null
    }
];

export const THERMAL_POWER_CHART_SERIES: MetricSeries[] = [
    {
        name: "Temperature(°C)",
        color: "#ff7043",
        getValue: (sample) => sample.metrics.temperature?.value ?? null
    },
    {
        name: "Power(mA)",
        color: "#ffee58",
        getValue: (sample) => sample.metrics.power?.value ?? null
    }
];