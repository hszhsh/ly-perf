export function formatDateTime(ts: number): string {
    return new Date(ts).toLocaleString();
}

export function formatDecimalValue(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatTrafficMegabytes(
    totalTrafficMb: number | null | undefined
): string {
    if (totalTrafficMb === null || totalTrafficMb === undefined) {
        return "N/A";
    }

    if (totalTrafficMb >= 1024) {
        return `${formatDecimalValue(totalTrafficMb / 1024)} GB`;
    }

    return `${formatDecimalValue(totalTrafficMb)} MB`;
}

export function formatPercentageValue(value: number | null): string {
    if (value === null) {
        return "N/A";
    }

    return `${formatDecimalValue(value)} %`;
}