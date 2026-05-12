import type {
    CapabilityAdapter,
    CapabilityGroup,
    MetricDatum
} from "@shared/types";

export function metric(
    value: number,
    unit: string,
    source: string
): MetricDatum {
    return {
        value,
        unit,
        source,
        available: true
    };
}

export function unavailable(
    unit: string,
    reason: string,
    source: string
): MetricDatum {
    return {
        value: null,
        unit,
        source,
        available: false,
        reason
    };
}

export function unavailableJankMetrics(
    reason: string,
    source: string
): {
    jankDatum: MetricDatum;
    bigJankDatum: MetricDatum;
} {
    return {
        jankDatum: unavailable("count", reason, source),
        bigJankDatum: unavailable("count", reason, source)
    };
}

export function round(value: number): number {
    return Number(value.toFixed(2));
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function parseFirstNumber(raw: string): number | null {
    const match = raw.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
        return null;
    }

    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
}

export function createAdapterCandidate(params: {
    key: string;
    label: string;
    vendor: string;
    source: string;
    unit: string;
    supported: boolean;
    value: number | null;
    reason?: string;
}): CapabilityAdapter {
    return {
        key: params.key,
        label: params.label,
        vendor: params.vendor,
        source: params.source,
        unit: params.unit,
        supported: params.supported,
        selected: false,
        value: params.value,
        reason: params.reason
    };
}

export function toCapabilityGroup(
    fallbackVendor: string,
    adapters: CapabilityAdapter[]
): CapabilityGroup {
    const selectedIndex = adapters.findIndex((adapter) => adapter.supported);
    const selectedAdapterKey =
        selectedIndex >= 0 ? adapters[selectedIndex].key : null;
    const vendor =
        selectedIndex >= 0 ? adapters[selectedIndex].vendor : fallbackVendor;

    return {
        vendor,
        selectedAdapterKey,
        adapters: adapters.map((adapter, index) => ({
            ...adapter,
            selected: index === selectedIndex
        }))
    };
}

export function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `"'"'`)}'`;
}
