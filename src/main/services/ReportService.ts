import { promises as fs } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import type {
    DeepMonitorChartDefinition,
    DeepMonitorMetricDefinition,
    ExportResult,
    SessionDetail
} from "@shared/types";
import { SessionStore } from "@main/services/SessionStore";

const METRIC_NAMES = [
    "fps",
    "jank",
    "bigJank",
    "cpu",
    "cpuTotal",
    "memory",
    "memoryGraphics",
    "memoryNativeHeap",
    "memoryPrivateOther",
    "networkRx",
    "networkTx",
    "networkTotal",
    "diskRead",
    "diskWrite",
    "gpu",
    "power",
    "temperature"
] as const;

type CsvValue = string | number | boolean | null | undefined;
type CsvRow = Record<string, CsvValue>;

const METRIC_CSV_HEADERS = ["timestamp", ...METRIC_NAMES] as const;
const EVENT_CSV_HEADERS = [
    "id",
    "timestamp",
    "type",
    "color",
    "text",
    "createdAt",
    "updatedAt"
] as const;
const CUSTOM_METRIC_HEADERS = [
    "key",
    "label",
    "unit",
    "color",
    "valueType",
    "aggregationHint",
    "description"
] as const;
const CUSTOM_CHART_HEADERS = [
    "id",
    "title",
    "order",
    "metricKeys",
    "description",
    "yAxisLabel",
    "yAxisUnit",
    "statsEnabled",
    "statsScope",
    "statsSurface",
    "statsComputations",
    "statsMetricKeys"
] as const;
const CUSTOM_SCHEMA_HISTORY_HEADERS = [
    "revision",
    "declaredAt",
    "protocolVersion",
    "metricCount",
    "chartCount"
] as const;
const CUSTOM_STATE_INTERVAL_HEADERS = [
    "chartId",
    "chartTitle",
    "metricKey",
    "metricLabel",
    "valueType",
    "startTimestamp",
    "endTimestamp",
    "durationMs",
    "sampleCount",
    "value"
] as const;

function toWebPath(value: string): string {
    return value.split(path.sep).join("/");
}

function buildMetricRows(
    session: SessionDetail
): Array<Record<string, number | string | null>> {
    return session.samples.map((sample) => {
        const row: Record<string, number | string | null> = {
            timestamp: new Date(sample.timestamp).toISOString(),
            screenshot: sample.screenshotPath ?? ""
        };

        for (const metricName of METRIC_NAMES) {
            row[metricName] = sample.metrics[metricName]?.value ?? null;
        }

        return row;
    });
}

function buildCsvMetricRows(
    session: SessionDetail
): Array<Record<string, number | string | null>> {
    return session.samples.map((sample) => {
        const row: Record<string, number | string | null> = {
            timestamp: new Date(sample.timestamp).toISOString()
        };

        for (const metricName of METRIC_NAMES) {
            row[metricName] = sample.metrics[metricName]?.value ?? null;
        }

        return row;
    });
}

function getEventDisplayText(event: SessionDetail["events"][number]): string {
    const normalizedText = event.text.trim();

    if (normalizedText) {
        return normalizedText;
    }

    return event.type === "screenshot" ? "截图" : "";
}

function toEventRow(
    event: SessionDetail["events"][number],
    text: string
): Record<string, string> {
    return {
        id: event.id,
        timestamp: new Date(event.timestamp).toISOString(),
        type: event.type,
        color: event.color,
        text,
        createdAt: new Date(event.createdAt).toISOString(),
        updatedAt: new Date(event.updatedAt).toISOString()
    };
}

function buildEventRows(
    session: SessionDetail
): Array<Record<string, string>> {
    return session.events.map((event) =>
        toEventRow(event, getEventDisplayText(event))
    );
}

function buildCsvEventRows(
    session: SessionDetail
): Array<Record<string, string>> {
    return session.events.flatMap((event) => {
        const normalizedText = event.text.trim();

        if (event.type === "screenshot" && !normalizedText) {
            return [];
        }

        return [toEventRow(event, normalizedText || getEventDisplayText(event))];
    });
}

function serializeChartDefinitionStats(
    definition: DeepMonitorChartDefinition
): Record<string, string | number | boolean | null> {
    return {
        id: definition.id,
        title: definition.title,
        order: definition.order ?? null,
        metricKeys: definition.metricKeys.join(", "),
        description: definition.description ?? "",
        yAxisLabel: definition.yAxisLabel ?? "",
        yAxisUnit: definition.yAxisUnit ?? "",
        statsEnabled: definition.stats.enabled,
        statsScope: definition.stats.scope,
        statsSurface: definition.stats.surface,
        statsComputations: definition.stats.computations.join(", "),
        statsMetricKeys: (definition.stats.metricKeys ?? []).join(", ")
    };
}

function serializeCustomSampleValue(
    value:
        | NonNullable<SessionDetail["customSamples"]>[number]["values"][string]
        | undefined
): string | number | null {
    if (Array.isArray(value)) {
        return JSON.stringify(value);
    }

    return value ?? null;
}

function getCustomMetricDefinitionMap(
    definitions: DeepMonitorMetricDefinition[] | undefined
): Map<string, DeepMonitorMetricDefinition> {
    return new Map((definitions ?? []).map((definition) => [definition.key, definition]));
}

function getCustomChartValueType(params: {
    chartDefinition: DeepMonitorChartDefinition;
    metricDefinitionMap: Map<string, DeepMonitorMetricDefinition>;
}): DeepMonitorMetricDefinition["valueType"] | null {
    const { chartDefinition, metricDefinitionMap } = params;
    const firstMetricKey = chartDefinition.metricKeys[0];

    if (!firstMetricKey) {
        return null;
    }

    return metricDefinitionMap.get(firstMetricKey)?.valueType ?? null;
}

function isStateSampleValue(
    value:
        | NonNullable<SessionDetail["customSamples"]>[number]["values"][string]
        | undefined
): value is string | string[] | null {
    return (
        value === null ||
        typeof value === "string" ||
        (Array.isArray(value) && value.every((item) => typeof item === "string"))
    );
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

function buildCustomStateIntervalRows(
    session: SessionDetail
): Array<Record<string, string | number | null>> {
    const metricDefinitionMap = getCustomMetricDefinitionMap(
        session.customMetricDefinitions
    );
    const sortedCustomSamples = [...(session.customSamples ?? [])].sort(
        (left, right) => {
            if (left.timestamp !== right.timestamp) {
                return left.timestamp - right.timestamp;
            }

            if (left.receivedAt !== right.receivedAt) {
                return left.receivedAt - right.receivedAt;
            }

            return (left.sequence ?? 0) - (right.sequence ?? 0);
        }
    );

    return (session.customChartDefinitions ?? [])
        .filter(
            (chartDefinition) =>
                getCustomChartValueType({
                    chartDefinition,
                    metricDefinitionMap
                }) !== "number"
        )
        .flatMap((chartDefinition) =>
            chartDefinition.metricKeys.flatMap((metricKey) => {
                const definition = metricDefinitionMap.get(metricKey);

                if (
                    !definition ||
                    (definition.valueType !== "string" &&
                        definition.valueType !== "string-list")
                ) {
                    return [];
                }

                const rows: Array<Record<string, string | number | null>> = [];
                let currentInterval:
                    | (Record<string, string | number | null> & {
                          valueKey: string;
                      })
                    | null = null;

                for (const sample of sortedCustomSamples) {
                    const rawValue = sample.values[metricKey];

                    if (!isStateSampleValue(rawValue)) {
                        currentInterval = null;
                        continue;
                    }

                    const value = Array.isArray(rawValue)
                        ? [...rawValue]
                        : rawValue;
                    const valueKey = getStateValueKey(value);

                    if (currentInterval && currentInterval.valueKey === valueKey) {
                        currentInterval.endTimestamp = new Date(
                            sample.timestamp
                        ).toISOString();
                        currentInterval.durationMs = Math.max(
                            0,
                            sample.timestamp - Date.parse(String(currentInterval.startTimestamp))
                        );
                        currentInterval.sampleCount =
                            Number(currentInterval.sampleCount) + 1;
                        continue;
                    }

                    currentInterval = {
                        chartId: chartDefinition.id,
                        chartTitle: chartDefinition.title,
                        metricKey,
                        metricLabel: definition.label,
                        valueType: definition.valueType,
                        startTimestamp: new Date(sample.timestamp).toISOString(),
                        endTimestamp: new Date(sample.timestamp).toISOString(),
                        durationMs: 0,
                        sampleCount: 1,
                        value: serializeCustomSampleValue(value),
                        valueKey
                    };
                    rows.push(currentInterval);
                }

                return rows.map(({ valueKey: _valueKey, ...row }) => row);
            })
        );
}

function buildCustomSampleRows(session: SessionDetail) {
    const metricKeys =
        session.customMetricDefinitions?.map((definition) => definition.key) ??
        Array.from(
            new Set(
                (session.customSamples ?? []).flatMap((sample) =>
                    Object.keys(sample.values)
                )
            )
        );

    return (session.customSamples ?? []).map((sample) => {
        const row: Record<string, number | string | null> = {
            timestamp: new Date(sample.timestamp).toISOString(),
            receivedAt: new Date(sample.receivedAt).toISOString(),
            schemaRevision: sample.schemaRevision,
            sequence: sample.sequence ?? null
        };

        for (const metricKey of metricKeys) {
            row[metricKey] = serializeCustomSampleValue(
                sample.values[metricKey]
            );
        }

        return row;
    });
}

function buildCustomMetricDefinitionRows(
    definitions: DeepMonitorMetricDefinition[] | undefined
): Array<Record<string, string | null>> {
    return (definitions ?? []).map((definition) => ({
        key: definition.key,
        label: definition.label,
        unit: definition.unit,
        color: definition.color ?? "",
        valueType: definition.valueType,
        aggregationHint: definition.aggregationHint ?? "",
        description: definition.description ?? ""
    }));
}

function buildCustomChartRows(
    definitions: DeepMonitorChartDefinition[] | undefined
): Array<Record<string, string | number | boolean | null>> {
    return (definitions ?? []).map((definition) =>
        serializeChartDefinitionStats(definition)
    );
}

function buildCustomSchemaHistoryRows(
    schemaHistory: SessionDetail["customSchemaHistory"]
): Array<Record<string, string | number | null>> {
    return (schemaHistory ?? []).map((revision) => ({
        revision: revision.revision,
        declaredAt: new Date(revision.declaredAt).toISOString(),
        protocolVersion: revision.protocolVersion ?? null,
        metricCount: revision.metrics.length,
        chartCount: revision.charts.length
    }));
}

function collectCsvHeaders(
    rows: CsvRow[],
    preferredHeaders?: readonly string[]
): string[] {
    const headers = [...(preferredHeaders ?? [])];
    const seen = new Set(headers);

    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (!seen.has(key)) {
                seen.add(key);
                headers.push(key);
            }
        }
    }

    return headers;
}

function serializeCsvCell(value: CsvValue): string {
    if (value === null || value === undefined) {
        return "";
    }

    const normalized = String(value);

    if (/[",\r\n]/.test(normalized)) {
        return `"${normalized.replace(/"/g, '""')}"`;
    }

    return normalized;
}

function serializeCsvRows(rows: CsvRow[], headers?: readonly string[]): string {
    const resolvedHeaders = collectCsvHeaders(rows, headers);

    if (resolvedHeaders.length === 0) {
        return "";
    }

    const lines = [resolvedHeaders.map((header) => serializeCsvCell(header)).join(",")];

    for (const row of rows) {
        lines.push(
            resolvedHeaders
                .map((header) => serializeCsvCell(row[header]))
                .join(",")
        );
    }

    return `\uFEFF${lines.join("\r\n")}\r\n`;
}

async function writeCsvFile(params: {
    outputDir: string;
    fileName: string;
    rows: CsvRow[];
    headers?: readonly string[];
}): Promise<void> {
    const { outputDir, fileName, rows, headers } = params;

    await fs.writeFile(
        path.join(outputDir, fileName),
        serializeCsvRows(rows, headers),
        "utf8"
    );
}

export class ReportService {
    constructor(
        private readonly store: SessionStore,
        private readonly appRoot: string
    ) {}

    async exportSession(
        sessionId: string,
        format: "html" | "xlsx" | "csv"
    ): Promise<ExportResult> {
        if (format === "html") {
            return this.exportHtml(sessionId);
        }

        if (format === "csv") {
            return this.exportCsv(sessionId);
        }

        return this.exportXlsx(sessionId);
    }

    private async exportHtml(sessionId: string): Promise<ExportResult> {
        const session = await this.store.getSession(sessionId);
        const outputDir = path.join(
            this.store.getDataDir(),
            "exports",
            sessionId,
            "html"
        );

        await fs.rm(outputDir, { recursive: true, force: true });
        await fs.mkdir(outputDir, { recursive: true });

        const reportSession = await this.copyScreenshotsForReport(
            session,
            outputDir
        );

        const echartsSource = path.join(
            this.appRoot,
            "node_modules",
            "echarts",
            "dist",
            "echarts.min.js"
        );
        const echartsTarget = path.join(outputDir, "echarts.min.js");

        await fs.copyFile(echartsSource, echartsTarget);
        await fs.writeFile(
            path.join(outputDir, "report.json"),
            JSON.stringify(reportSession, null, 2),
            "utf8"
        );
        await fs.writeFile(
            path.join(outputDir, "index.html"),
            this.buildHtmlTemplate(),
            "utf8"
        );

        return {
            format: "html",
            outputPath: path.join(outputDir, "index.html")
        };
    }

    private async exportCsv(sessionId: string): Promise<ExportResult> {
        const session = await this.store.getSession(sessionId);
        const outputDir = path.join(
            this.store.getDataDir(),
            "exports",
            sessionId,
            "csv"
        );

        await fs.rm(outputDir, { recursive: true, force: true });
        await fs.mkdir(outputDir, { recursive: true });

        const customStateIntervalRows = buildCustomStateIntervalRows(session);
        const writes: Promise<void>[] = [
            writeCsvFile({
                outputDir,
                fileName: "metrics.csv",
                rows: buildCsvMetricRows(session),
                headers: METRIC_CSV_HEADERS
            }),
            writeCsvFile({
                outputDir,
                fileName: "events.csv",
                rows: buildCsvEventRows(session),
                headers: EVENT_CSV_HEADERS
            })
        ];

        if ((session.customMetricDefinitions?.length ?? 0) > 0) {
            writes.push(
                writeCsvFile({
                    outputDir,
                    fileName: "custom_metrics.csv",
                    rows: buildCustomMetricDefinitionRows(
                        session.customMetricDefinitions
                    ),
                    headers: CUSTOM_METRIC_HEADERS
                })
            );
        }

        if ((session.customChartDefinitions?.length ?? 0) > 0) {
            writes.push(
                writeCsvFile({
                    outputDir,
                    fileName: "custom_charts.csv",
                    rows: buildCustomChartRows(session.customChartDefinitions),
                    headers: CUSTOM_CHART_HEADERS
                })
            );
        }

        if ((session.customSchemaHistory?.length ?? 0) > 0) {
            writes.push(
                writeCsvFile({
                    outputDir,
                    fileName: "custom_schema_history.csv",
                    rows: buildCustomSchemaHistoryRows(
                        session.customSchemaHistory
                    ),
                    headers: CUSTOM_SCHEMA_HISTORY_HEADERS
                })
            );
        }

        if ((session.customSamples?.length ?? 0) > 0) {
            writes.push(
                writeCsvFile({
                    outputDir,
                    fileName: "custom_samples.csv",
                    rows: buildCustomSampleRows(session)
                })
            );
        }

        if (customStateIntervalRows.length > 0) {
            writes.push(
                writeCsvFile({
                    outputDir,
                    fileName: "custom_state_intervals.csv",
                    rows: customStateIntervalRows,
                    headers: CUSTOM_STATE_INTERVAL_HEADERS
                })
            );
        }

        await Promise.all(writes);

        return {
            format: "csv",
            outputPath: outputDir
        };
    }

    private async exportXlsx(sessionId: string): Promise<ExportResult> {
        const session = await this.store.getSession(sessionId);
        const outputDir = path.join(
            this.store.getDataDir(),
            "exports",
            sessionId,
            "xlsx"
        );

        await fs.mkdir(outputDir, { recursive: true });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(buildMetricRows(session));
        const eventWorksheet = XLSX.utils.json_to_sheet(
            buildEventRows(session),
            {
                header: [...EVENT_CSV_HEADERS]
            }
        );

        XLSX.utils.book_append_sheet(workbook, worksheet, "metrics");
        XLSX.utils.book_append_sheet(workbook, eventWorksheet, "events");

        if ((session.customMetricDefinitions?.length ?? 0) > 0) {
            const customMetricWorksheet = XLSX.utils.json_to_sheet(
                buildCustomMetricDefinitionRows(session.customMetricDefinitions)
            );

            XLSX.utils.book_append_sheet(
                workbook,
                customMetricWorksheet,
                "custom_metrics"
            );
        }

        if ((session.customChartDefinitions?.length ?? 0) > 0) {
            const customChartWorksheet = XLSX.utils.json_to_sheet(
                buildCustomChartRows(session.customChartDefinitions)
            );

            XLSX.utils.book_append_sheet(
                workbook,
                customChartWorksheet,
                "custom_charts"
            );
        }

        if ((session.customSchemaHistory?.length ?? 0) > 0) {
            const schemaWorksheet = XLSX.utils.json_to_sheet(
                buildCustomSchemaHistoryRows(session.customSchemaHistory)
            );

            XLSX.utils.book_append_sheet(
                workbook,
                schemaWorksheet,
                "custom_schema_history"
            );
        }

        if ((session.customSamples?.length ?? 0) > 0) {
            const customSampleWorksheet = XLSX.utils.json_to_sheet(
                buildCustomSampleRows(session)
            );

            XLSX.utils.book_append_sheet(
                workbook,
                customSampleWorksheet,
                "custom_samples"
            );
        }

        const customStateIntervalRows = buildCustomStateIntervalRows(session);

        if (customStateIntervalRows.length > 0) {
            const customStateWorksheet = XLSX.utils.json_to_sheet(
                customStateIntervalRows
            );

            XLSX.utils.book_append_sheet(
                workbook,
                customStateWorksheet,
                "custom_state_intervals"
            );
        }

        const outputPath = path.join(outputDir, `${sessionId}.xlsx`);
        XLSX.writeFile(workbook, outputPath);

        return {
            format: "xlsx",
            outputPath
        };
    }

    private async copyScreenshotsForReport(
        session: SessionDetail,
        outputDir: string
    ): Promise<SessionDetail> {
        const screenshotDir = path.join(outputDir, "screenshots");
        await fs.mkdir(screenshotDir, { recursive: true });

        const copiedPathMap = new Map<string, string>();

        const copyScreenshotPath = async (
            sourcePath: string,
            fileNamePrefix: string
        ): Promise<string | undefined> => {
            if (copiedPathMap.has(sourcePath)) {
                return copiedPathMap.get(sourcePath) || undefined;
            }

            const ext = path.extname(sourcePath) || ".png";
            const targetPath = path.join(screenshotDir, `${fileNamePrefix}${ext}`);

            try {
                await fs.copyFile(sourcePath, targetPath);
                const webPath = toWebPath(path.join("screenshots", `${fileNamePrefix}${ext}`));
                copiedPathMap.set(sourcePath, webPath);
                return webPath;
            } catch {
                copiedPathMap.set(sourcePath, "");
                return undefined;
            }
        };

        const samples = await Promise.all(
            session.samples.map(async (sample, index) => {
                if (!sample.screenshotPath) {
                    return sample;
                }

                const copied = await copyScreenshotPath(
                    sample.screenshotPath,
                    `sample-${index.toString().padStart(6, "0")}`
                );

                return {
                    ...sample,
                    screenshotPath: copied
                };
            })
        );

        const events = await Promise.all(
            session.events.map(async (event, index) => {
                if (!event.screenshotPath) {
                    return event;
                }

                const copied = await copyScreenshotPath(
                    event.screenshotPath,
                    `event-${index.toString().padStart(6, "0")}`
                );

                return {
                    ...event,
                    screenshotPath: copied
                };
            })
        );

        return {
            ...session,
            samples,
            events
        };
    }

    private buildHtmlTemplate(): string {
        return `<!doctype html>
<html lang="zh-CN">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>LY Perf HTML Report</title>
        <script src="./echarts.min.js"></script>
        <style>
            body {
                margin: 0;
                background: radial-gradient(circle at 18% 16%, #32475d, #18212d 58%, #10151f 100%);
                color: #dbe4ee;
                font-family: "Bahnschrift", "Trebuchet MS", sans-serif;
            }
            .wrap {
                display: grid;
                grid-template-columns: minmax(0, 2.1fr) minmax(300px, 0.9fr);
                gap: 12px;
                padding: 12px;
                min-height: 100vh;
                box-sizing: border-box;
            }
            .wrap.wrapNoPreview {
                grid-template-columns: minmax(0, 1fr);
            }
            .panel {
                background: rgba(10, 16, 24, 0.78);
                border: 1px solid rgba(102, 128, 153, 0.35);
                border-radius: 12px;
                overflow: hidden;
            }
            .chartStack {
                display: grid;
                gap: 12px;
                padding: 12px;
            }
            .chartCard {
                background: rgba(12, 19, 29, 0.76);
                border: 1px solid rgba(102, 128, 153, 0.24);
                border-radius: 12px;
                overflow: hidden;
            }
            .chartHead {
                display: grid;
                gap: 4px;
                padding: 12px 14px;
                border-bottom: 1px solid rgba(102, 128, 153, 0.22);
            }
            .chartHead strong {
                font-size: 14px;
                letter-spacing: 0.04em;
            }
            .chartHead span {
                font-size: 11px;
                color: #91a7c0;
            }
            .chartSurface {
                height: 320px;
            }
            .sessionInfo {
                padding: 12px;
            }
            .sessionInfoCard {
                display: grid;
                gap: 10px;
                padding: 12px;
                border-radius: 12px;
                border: 1px solid rgba(116, 145, 171, 0.24);
                background: rgba(11, 18, 28, 0.74);
            }
            .sessionInfoHead {
                display: grid;
                gap: 4px;
            }
            .sessionInfoHead strong {
                font-size: 14px;
                color: #eff6ff;
                letter-spacing: 0.03em;
            }
            .sessionInfoHead span {
                font-size: 12px;
                color: #91a7c0;
            }
            .sessionInfoGrid {
                display: grid;
                gap: 8px;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            }
            .sessionInfoItem {
                display: grid;
                gap: 3px;
                padding: 8px 10px;
                border-radius: 8px;
                border: 1px solid rgba(116, 145, 171, 0.14);
                background: rgba(9, 15, 24, 0.68);
            }
            .sessionInfoItem span {
                font-size: 10px;
                color: #8ea1b7;
                text-transform: uppercase;
                letter-spacing: 0.08em;
            }
            .sessionInfoItem strong {
                font-size: 12px;
                color: #e8f1fb;
                word-break: break-word;
            }
            .chartStatsPanel {
                margin: 10px 12px 0;
                padding: 10px;
                border-radius: 10px;
                border: 1px solid rgba(116, 145, 171, 0.2);
                background: rgba(10, 17, 27, 0.72);
            }
            .chartStatsHeader {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 8px;
                flex-wrap: wrap;
                margin-bottom: 8px;
            }
            .chartStatsHeader strong {
                font-size: 12px;
                color: #eff6ff;
            }
            .chartStatsHeader span {
                font-size: 11px;
                color: #91a7c0;
            }
            .chartStatsGrid {
                display: grid;
                gap: 8px;
                grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            }
            .chartStatsCard {
                display: grid;
                gap: 4px;
                padding: 8px;
                border-radius: 8px;
                border: 1px solid rgba(116, 145, 171, 0.16);
                background: rgba(8, 14, 23, 0.78);
            }
            .chartStatsCard strong {
                font-size: 12px;
                color: #eff6ff;
            }
            .chartStatsCard span {
                font-size: 11px;
                color: #9fb3cb;
            }
            .timelineEventList {
                display: grid;
                gap: 8px;
                padding: 12px;
            }
            .timelineEventItem {
                width: 100%;
                text-align: left;
                display: grid;
                gap: 6px;
                padding: 10px 12px;
                border-radius: 10px;
                border: 1px solid rgba(116, 145, 171, 0.18);
                background: rgba(9, 16, 25, 0.76);
                color: #dbe4ee;
                cursor: pointer;
            }
            .timelineEventItem:hover {
                border-color: rgba(130, 199, 255, 0.4);
                background: rgba(11, 19, 30, 0.92);
            }
            .timelineEventItemHeader {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 8px;
                flex-wrap: wrap;
            }
            .timelineEventItemTitle {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
            }
            .timelineEventColorDot {
                width: 10px;
                height: 10px;
                border-radius: 999px;
                box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18) inset;
            }
            .timelineEventType {
                font-size: 11px;
                color: #eff6ff;
            }
            .timelineEventMeta {
                font-size: 11px;
                color: #8ea1b7;
            }
            .timelineEventText {
                margin: 0;
                font-size: 12px;
                color: #e9f2fd;
                line-height: 1.45;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .timelineEventScreenshot {
                width: 100%;
                border-radius: 8px;
                background: #0f141c;
                border: 1px solid rgba(102, 128, 153, 0.35);
            }
            .timelineEventLocate {
                font-size: 11px;
                color: #78c8ff;
            }
            .eventTooltipScreenshot {
                width: 100%;
                margin-top: 8px;
                border-radius: 8px;
                background: #0f141c;
                border: 1px solid rgba(102, 128, 153, 0.35);
            }
            .stateTrackStack {
                display: grid;
                gap: 10px;
                padding: 12px;
            }
            .stateTrack {
                display: grid;
                gap: 8px;
                padding: 10px;
                border-radius: 10px;
                border: 1px solid rgba(116, 145, 171, 0.16);
                background: rgba(13, 21, 33, 0.72);
            }
            .stateTrackHeader,
            .stateTrackTitle,
            .stateSegmentHeader {
                display: flex;
                gap: 8px;
            }
            .stateTrackHeader,
            .stateSegmentHeader {
                align-items: flex-start;
                justify-content: space-between;
                flex-wrap: wrap;
            }
            .stateTrackTitle {
                align-items: center;
            }
            .stateColorDot {
                width: 10px;
                height: 10px;
                border-radius: 999px;
                box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18) inset;
            }
            .stateTrackTitle strong {
                font-size: 12px;
                color: #eff6ff;
            }
            .stateTrackMeta,
            .stateSegmentTime,
            .stateSegmentMeta,
            .stateSegmentCount {
                font-size: 11px;
                color: #8ea1b7;
            }
            .stateSegmentList {
                display: grid;
                gap: 8px;
            }
            .stateSegment {
                width: 100%;
                text-align: left;
                display: grid;
                gap: 6px;
                padding: 10px 12px;
                border-radius: 10px;
                border: 1px solid rgba(116, 145, 171, 0.18);
                border-left: 4px solid var(--segment-accent, #7dd3fc);
                background: rgba(8, 14, 23, 0.82);
            }
            .stateSegment:hover {
                border-color: rgba(130, 199, 255, 0.4);
                background: rgba(10, 18, 28, 0.92);
            }
            .stateSegmentValue {
                font-size: 12px;
                color: #eff6ff;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .stateEmpty {
                margin: 0;
                padding: 12px;
                color: #91a7c0;
                font-size: 12px;
            }
            .preview {
                padding: 10px;
                position: sticky;
                top: 12px;
                height: fit-content;
            }
            .preview img {
                width: 100%;
                border-radius: 8px;
                background: #0f141c;
                border: 1px solid rgba(102, 128, 153, 0.35);
            }
            .meta {
                font-size: 12px;
                color: #8ca0b8;
                margin-bottom: 8px;
                line-height: 1.5;
            }
            .title {
                margin: 0;
                padding: 12px;
                border-bottom: 1px solid rgba(102, 128, 153, 0.35);
                letter-spacing: 0.4px;
            }
            .empty {
                margin: 0;
                padding: 24px 16px;
                color: #91a7c0;
                text-align: center;
            }
        </style>
    </head>
    <body>
        <div id="reportWrap" class="wrap">
            <section class="panel">
                <h3 class="title">Performance Timeline</h3>
                <div id="sessionInfo" class="sessionInfo"></div>
                <div id="charts" class="chartStack"></div>
                <div id="states" class="chartStack"></div>
                <div id="timelineEvents" class="chartStack"></div>
            </section>
            <section id="previewPanel" class="panel preview">
                <div id="meta" class="meta"></div>
                <img id="shot" alt="screenshot preview" />
            </section>
        </div>

        <script>
            const BUILTIN_CHARTS = [
                {
                    id: "builtin-fps",
                    title: "帧率（FPS）",
                    description: "内置采样指标",
                    series: [
                        { key: "fps", name: "FPS", color: "#e24a6e" },
                        { key: "jank", name: "Jank", color: "#f4b860" },
                        { key: "bigJank", name: "Big Jank", color: "#ff7a59" }
                    ]
                },
                {
                    id: "builtin-load",
                    title: "负载（App CPU / Total CPU / GPU）",
                    description: "内置采样指标",
                    series: [
                        { key: "cpu", name: "App CPU(%)", color: "#5ca6ff" },
                        { key: "cpuTotal", name: "Total CPU(%)", color: "#59d6d6" },
                        { key: "gpu", name: "GPU(%)", color: "#7bd389" }
                    ]
                },
                {
                    id: "builtin-memory",
                    title: "内存细分（MB）",
                    description: "内置采样指标",
                    series: [
                        { key: "memory", name: "PSS Total", color: "#f4b860" },
                        { key: "memoryGraphics", name: "Graphics", color: "#4fc3f7" },
                        { key: "memoryNativeHeap", name: "Native Heap", color: "#81c784" },
                        { key: "memoryPrivateOther", name: "Private Other", color: "#ff8a65" }
                    ]
                },
                {
                    id: "builtin-throughput",
                    title: "资源吞吐（网络上下行速率 / 磁盘）",
                    description: "内置采样指标",
                    series: [
                        { key: "networkRx", name: "下行 KB/s", color: "#4dd0e1" },
                        { key: "networkTx", name: "上行 KB/s", color: "#26a69a" },
                        { key: "diskRead", name: "Disk Read", color: "#ab47bc" },
                        { key: "diskWrite", name: "Disk Write", color: "#7e57c2" }
                    ]
                },
                {
                    id: "builtin-thermal-power",
                    title: "温度与功耗",
                    description: "内置采样指标",
                    series: [
                        { key: "temperature", name: "Temperature(°C)", color: "#ff7043" },
                        { key: "power", name: "Power(mA)", color: "#ffee58" }
                    ]
                }
            ];
            const CUSTOM_COLORS = ["#4dd0e1", "#ff8a65", "#7bd389", "#ffd54f", "#9575cd", "#f06292", "#64b5f6", "#90a4ae"];

            function formatAxisTime(timestamp) {
                return new Date(timestamp).toLocaleTimeString([], {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                });
            }

            function formatMetaTime(timestamp) {
                return new Date(timestamp).toLocaleString([], {
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

            function escapeHtml(value) {
                return String(value)
                    .replaceAll("&", "&amp;")
                    .replaceAll("<", "&lt;")
                    .replaceAll(">", "&gt;")
                    .replaceAll('"', "&quot;")
                    .replaceAll("'", "&#39;");
            }

            function getTimelineEventTypeLabel(type) {
                if (type === "action") {
                    return "操作";
                }

                if (type === "issue") {
                    return "问题";
                }

                return "备注";
            }

            function getTimelineEventDisplayText(event) {
                const normalizedText = String(event.text || '').trim();

                if (normalizedText.length > 0) {
                    return normalizedText;
                }

                return event.type === 'screenshot' ? '截图' : '';
            }

            function formatSessionTime(timestamp) {
                const normalizedTimestamp = Number(timestamp);

                if (!Number.isFinite(normalizedTimestamp)) {
                    return 'N/A';
                }

                return formatMetaTime(normalizedTimestamp);
            }

            function formatInfoValue(value) {
                if (value === null || value === undefined) {
                    return 'N/A';
                }

                const normalizedValue = String(value).trim();
                return normalizedValue.length > 0 ? normalizedValue : 'N/A';
            }

            function formatCpuModeLabel(cpuMode) {
                return cpuMode === 'normalized'
                    ? 'CPU Usage (Normalized)'
                    : 'CPU Usage（传统）';
            }

            function formatFpsModeLabel(fpsMode) {
                return fpsMode === 'gfxinfo' ? 'gfxinfo' : 'SurfaceFlinger';
            }

            function renderSessionInfo(report) {
                const sessionInfoNode = document.getElementById('sessionInfo');

                if (!sessionInfoNode) {
                    return;
                }

                const deviceInfo = report.deviceInfo || {};
                const config = report.config || {};
                const deviceName = [deviceInfo.brand, deviceInfo.model]
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
                    .join(' ');
                const androidVersionLabel = [
                    deviceInfo.androidVersion
                        ? 'Android ' + String(deviceInfo.androidVersion).trim()
                        : '',
                    deviceInfo.sdkInt
                        ? 'SDK ' + String(deviceInfo.sdkInt).trim()
                        : ''
                ]
                    .filter(Boolean)
                    .join(' / ');
                const sampleIntervalLabel = Number.isFinite(
                    Number(config.sampleIntervalMs)
                )
                    ? Number(config.sampleIntervalMs) + ' ms'
                    : 'N/A';
                const screenshotPolicyLabel = config.screenshotEnabled
                    ? '开启（' +
                      (Number.isFinite(Number(config.screenshotIntervalMs))
                          ? Number(config.screenshotIntervalMs) + ' ms'
                          : '间隔未知') +
                      '）'
                    : '关闭';
                const infoItems = [
                    {
                        label: '包名',
                        value: report.packageName
                    },
                    {
                        label: '设备',
                        value: deviceName || report.serial || deviceInfo.serial
                    },
                    {
                        label: '序列号',
                        value: report.serial || deviceInfo.serial
                    },
                    {
                        label: '系统',
                        value: androidVersionLabel
                    },
                    {
                        label: '分辨率',
                        value: deviceInfo.resolution
                    },
                    {
                        label: 'CPU',
                        value: deviceInfo.cpuModel
                    },
                    {
                        label: 'GPU',
                        value: deviceInfo.gpuModel
                    },
                    {
                        label: 'OpenGL',
                        value: deviceInfo.openGlVersion
                    },
                    {
                        label: 'Vulkan',
                        value: deviceInfo.vulkanVersion
                    },
                    {
                        label: 'FPS来源',
                        value: formatFpsModeLabel(config.fpsMode)
                    },
                    {
                        label: 'CPU口径',
                        value: formatCpuModeLabel(config.cpuMode)
                    },
                    {
                        label: '采样间隔',
                        value: sampleIntervalLabel
                    },
                    {
                        label: '截图策略',
                        value: screenshotPolicyLabel
                    },
                    {
                        label: '开始时间',
                        value: formatSessionTime(report.startedAt)
                    },
                    {
                        label: '结束时间',
                        value: formatSessionTime(report.endedAt)
                    }
                ];

                sessionInfoNode.innerHTML =
                    '<div class="sessionInfoCard">' +
                        '<div class="sessionInfoHead">' +
                            '<strong>' +
                                escapeHtml(
                                    report.displayName ||
                                        report.packageName ||
                                        '历史会话'
                                ) +
                            '</strong>' +
                            '<span>' +
                                '样本数 ' +
                                escapeHtml(String(report.sampleCount || 0)) +
                                ' | 会话ID ' +
                                escapeHtml(report.id || '') +
                            '</span>' +
                        '</div>' +
                        '<div class="sessionInfoGrid">' +
                            infoItems
                                .map(
                                    (item) =>
                                        '<div class="sessionInfoItem">' +
                                            '<span>' +
                                                escapeHtml(item.label) +
                                            '</span>' +
                                            '<strong>' +
                                                escapeHtml(
                                                    formatInfoValue(item.value)
                                                ) +
                                            '</strong>' +
                                        '</div>'
                                )
                                .join('') +
                        '</div>' +
                    '</div>';
            }

            function normalizeStatsComputations(computations) {
                const defaultComputations = ['max', 'min', 'average'];

                if (!Array.isArray(computations) || computations.length === 0) {
                    return defaultComputations;
                }

                const normalized = computations.filter((computation) =>
                    computation === 'max' ||
                    computation === 'min' ||
                    computation === 'average'
                );

                return normalized.length > 0
                    ? normalized
                    : defaultComputations;
            }

            function calculateNumericStats(values) {
                const normalizedValues = (values || []).filter(
                    (value) => typeof value === 'number' && Number.isFinite(value)
                );

                if (!normalizedValues.length) {
                    return null;
                }

                const total = normalizedValues.reduce(
                    (sum, value) => sum + value,
                    0
                );

                return {
                    min: Math.min.apply(null, normalizedValues),
                    max: Math.max.apply(null, normalizedValues),
                    average: total / normalizedValues.length
                };
            }

            function normalizeVisibleTimeRange(range, samples) {
                const fullRange = getSampleTimeDomain(samples);

                if (!fullRange) {
                    return null;
                }

                if (!range) {
                    return fullRange;
                }

                let startTimestamp = Number(range.startTimestamp);
                let endTimestamp = Number(range.endTimestamp);

                if (
                    !Number.isFinite(startTimestamp) ||
                    !Number.isFinite(endTimestamp)
                ) {
                    return fullRange;
                }

                if (endTimestamp < startTimestamp) {
                    const swapValue = startTimestamp;
                    startTimestamp = endTimestamp;
                    endTimestamp = swapValue;
                }

                startTimestamp = Math.max(
                    fullRange.startTimestamp,
                    Math.floor(startTimestamp)
                );
                endTimestamp = Math.min(
                    fullRange.endTimestamp,
                    Math.ceil(endTimestamp)
                );

                if (endTimestamp < startTimestamp) {
                    return fullRange;
                }

                return {
                    startTimestamp,
                    endTimestamp
                };
            }

            function isTimestampWithinRange(timestamp, range) {
                const normalizedTimestamp = Number(timestamp);

                if (!Number.isFinite(normalizedTimestamp)) {
                    return false;
                }

                if (!range) {
                    return true;
                }

                return (
                    normalizedTimestamp >= range.startTimestamp &&
                    normalizedTimestamp <= range.endTimestamp
                );
            }

            function getSampleRangeLabel(samples, range, prefix) {
                const normalizedRange = normalizeVisibleTimeRange(range, samples);

                if (!normalizedRange) {
                    return '暂无可统计数据';
                }

                const startIndex = findNearestSampleIndex(
                    samples,
                    normalizedRange.startTimestamp
                );
                const endIndex = findNearestSampleIndex(
                    samples,
                    normalizedRange.endTimestamp
                );

                if (startIndex < 0 || endIndex < 0) {
                    return '暂无可统计数据';
                }

                const lowerIndex = Math.min(startIndex, endIndex);
                const upperIndex = Math.max(startIndex, endIndex);
                const rangePrefix =
                    typeof prefix === 'string' && prefix.trim().length > 0
                        ? prefix.trim()
                        : '样本';

                return (
                    rangePrefix + ' ' + (lowerIndex + 1) + ' - ' + (upperIndex + 1)
                );
            }

            function getStatsScopeLabel(scope) {
                return scope === 'visible-range' ? '可见范围统计' : '全会话统计';
            }

            function collectBuiltinMetricValues(samples, metricKey, range) {
                return (samples || [])
                    .filter((sample) =>
                        isTimestampWithinRange(
                            sample && sample.timestamp,
                            range
                        )
                    )
                    .map((sample) =>
                        sample && sample.metrics ? sample.metrics[metricKey] : null
                    )
                    .filter(
                        (metric) =>
                            metric &&
                            metric.available &&
                            typeof metric.value === 'number' &&
                            Number.isFinite(metric.value)
                    )
                    .map((metric) => metric.value);
            }

            function collectCustomMetricValues(samples, metricKey, range) {
                return (samples || [])
                    .filter((sample) =>
                        isTimestampWithinRange(
                            sample && sample.timestamp,
                            range
                        )
                    )
                    .map((sample) =>
                        sample && sample.values ? sample.values[metricKey] : undefined
                    )
                    .filter(
                        (value) =>
                            typeof value === 'number' && Number.isFinite(value)
                    );
            }

            function resolveStatsCardRange(samples, statsCard, visibleTimeRange) {
                if (!statsCard || statsCard.scope !== 'visible-range') {
                    return normalizeVisibleTimeRange(null, samples);
                }

                return normalizeVisibleTimeRange(visibleTimeRange, samples);
            }

            function buildResolvedStatsCard(params) {
                const {
                    statsCard,
                    samples,
                    visibleTimeRange
                } = params;

                if (
                    !statsCard ||
                    !Array.isArray(statsCard.items) ||
                    statsCard.items.length === 0
                ) {
                    return null;
                }

                const range = resolveStatsCardRange(
                    samples,
                    statsCard,
                    visibleTimeRange
                );
                const items = statsCard.items.map((item) => {
                    const values = item.source === 'custom'
                        ? collectCustomMetricValues(samples, item.key, range)
                        : collectBuiltinMetricValues(samples, item.key, range);

                    return {
                        key: item.key,
                        label: item.label,
                        unit: item.unit,
                        computations: item.computations,
                        stats: calculateNumericStats(values)
                    };
                });
                const hasAnyStats = items.some((item) => item.stats !== null);

                if (!hasAnyStats) {
                    return null;
                }

                return {
                    title: statsCard.title,
                    scopeLabel: getStatsScopeLabel(statsCard.scope),
                    rangeLabel: getSampleRangeLabel(
                        samples,
                        range,
                        statsCard.rangePrefix
                    ),
                    items
                };
            }

            function formatStatsValue(value, unit) {
                if (typeof value !== 'number' || !Number.isFinite(value)) {
                    return 'N/A';
                }

                const normalizedValue = value.toLocaleString(undefined, {
                    maximumFractionDigits: 2
                });
                return unit
                    ? normalizedValue + ' ' + String(unit).trim()
                    : normalizedValue;
            }

            function getStatsComputationLabel(computation) {
                if (computation === 'max') {
                    return '最大值';
                }

                if (computation === 'min') {
                    return '最小值';
                }

                return '平均值';
            }

            function renderChartStatsPanel(statsCard) {
                if (
                    !statsCard ||
                    !Array.isArray(statsCard.items) ||
                    statsCard.items.length === 0
                ) {
                    return '';
                }

                const summaryParts = [statsCard.scopeLabel, statsCard.rangeLabel]
                    .filter(Boolean)
                    .map((value) => String(value));

                return (
                    '<div class="chartStatsPanel">' +
                        '<div class="chartStatsHeader">' +
                            '<strong>' +
                                escapeHtml(
                                    statsCard.title || '图表统计'
                                ) +
                            '</strong>' +
                            '<span>' +
                                escapeHtml(summaryParts.join(' | ')) +
                            '</span>' +
                        '</div>' +
                        '<div class="chartStatsGrid">' +
                            statsCard.items
                                .map((item) => {
                                    const computations = normalizeStatsComputations(
                                        item.computations
                                    );

                                    return (
                                        '<div class="chartStatsCard">' +
                                            '<strong>' +
                                                escapeHtml(
                                                    item.label || item.key || '指标'
                                                ) +
                                            '</strong>' +
                                            computations
                                                .map((computation) => {
                                                    const statsValue = item.stats
                                                        ? item.stats[computation]
                                                        : null;

                                                    return (
                                                        '<span>' +
                                                            escapeHtml(
                                                                getStatsComputationLabel(
                                                                    computation
                                                                )
                                                            ) +
                                                            ' ' +
                                                            escapeHtml(
                                                                formatStatsValue(
                                                                    statsValue,
                                                                    item.unit
                                                                )
                                                            ) +
                                                        '</span>'
                                                    );
                                                })
                                                .join('') +
                                        '</div>'
                                    );
                                })
                                .join('') +
                        '</div>' +
                    '</div>'
                );
            }

            function renderTooltipSurface(content) {
                return '<div style="min-width:260px;max-width:340px;padding:14px 14px 12px;border:1px solid rgba(121, 151, 181, 0.28);border-radius:12px;background:linear-gradient(180deg, rgba(18, 28, 42, 0.98), rgba(8, 14, 23, 0.96));box-shadow:0 16px 42px rgba(0, 0, 0, 0.34);backdrop-filter:blur(8px);">' + content + '</div>';
            }

            function renderTooltipColorDot(color, size) {
                const dotSize = size || 10;
                return '<span style="display:inline-block;width:' + dotSize + 'px;height:' + dotSize + 'px;border-radius:999px;background:' + escapeHtml(color || "#7dd3fc") + ';box-shadow:0 0 0 1px rgba(255, 255, 255, 0.18) inset;"></span>';
            }

            function renderTooltipBadge(label, color) {
                return '<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid rgba(146, 173, 198, 0.24);background:rgba(21, 33, 47, 0.78);font-size:10px;color:' + escapeHtml(color || "#dbe7f6") + ';">' + escapeHtml(label) + '</span>';
            }

            function renderTooltipHeader(options) {
                return [
                    '<div style="display:grid;gap:5px;margin-bottom:10px;">',
                    options.eyebrow
                        ? '<div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8ea1b7;">' + escapeHtml(options.eyebrow) + '</div>'
                        : '',
                    '<div style="display:flex;align-items:flex-start;gap:8px;min-width:0;">',
                    options.accentColor ? renderTooltipColorDot(options.accentColor) : '',
                    '<div style="font-size:13px;font-weight:700;color:#eff6ff;min-width:0;">' + escapeHtml(options.title) + '</div>',
                    '</div>',
                    options.meta
                        ? '<div style="font-size:11px;color:#9fb3cb;">' + escapeHtml(options.meta) + '</div>'
                        : '',
                    '</div>'
                ].join('');
            }

            function renderTooltipMetricRow(color, label, value) {
                return [
                    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid rgba(140, 160, 184, 0.1);">',
                    '<div style="display:flex;align-items:center;gap:8px;min-width:0;">',
                    renderTooltipColorDot(color, 8),
                    '<span style="font-size:12px;color:#d7e2ef;min-width:0;">' + escapeHtml(label) + '</span>',
                    '</div>',
                    '<span style="font-size:12px;font-weight:600;color:#eff6ff;text-align:right;">' + escapeHtml(value) + '</span>',
                    '</div>'
                ].join('');
            }

            function renderEventTooltipCard(data) {
                const metaParts = [data.eventTimeLabel, data.eventSampleLabel].filter(Boolean);
                const eventScreenshotPath =
                    typeof data.eventScreenshotPath === 'string'
                        ? data.eventScreenshotPath.trim()
                        : '';

                return [
                    '<div style="display:grid;gap:8px;padding:10px 12px;border-radius:10px;border:1px solid rgba(116, 145, 171, 0.18);background:rgba(10, 17, 27, 0.7);">',
                    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap;">',
                    '<div style="display:flex;align-items:center;gap:8px;">',
                    renderTooltipColorDot(data.eventColor || '#7dd3fc', 9),
                    renderTooltipBadge(data.eventTypeLabel || '事件', data.eventColor),
                    '</div>',
                    metaParts.length > 0
                        ? '<div style="font-size:11px;color:#9fb3cb;">' + escapeHtml(metaParts.join(' | ')) + '</div>'
                        : '',
                    '</div>',
                    '<div style="font-size:12px;line-height:1.5;white-space:pre-wrap;color:#e9f2fd;">' + escapeHtml(data.eventFullText || '') + '</div>',
                    eventScreenshotPath
                        ? '<img class="eventTooltipScreenshot" src="' + escapeHtml(eventScreenshotPath) + '" alt="event screenshot" />'
                        : '',
                    '</div>'
                ].join('');
            }

            function formatTooltipMetricValue(value) {
                if (value === null || value === undefined || value === '-') {
                    return 'N/A';
                }

                if (typeof value === 'number') {
                    return Number.isFinite(value)
                        ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : 'N/A';
                }

                return String(value);
            }

            function findNearestSampleIndex(samples, timestamp) {
                if (!samples.length) {
                    return -1;
                }

                let low = 0;
                let high = samples.length - 1;

                while (low <= high) {
                    const middle = Math.floor((low + high) / 2);
                    const middleTimestamp = samples[middle].timestamp;

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

                const nextDistance = Math.abs(samples[low].timestamp - timestamp);
                const previousDistance = Math.abs(samples[high].timestamp - timestamp);

                return previousDistance <= nextDistance ? high : low;
            }

            function getAverageSampleInterval(samples) {
                if (samples.length <= 1) {
                    return 1000;
                }

                const firstTimestamp = samples[0].timestamp;
                const lastTimestamp = samples[samples.length - 1].timestamp;
                return Math.max(1, (lastTimestamp - firstTimestamp) / (samples.length - 1));
            }

            function getEventSampleLabel(samples, timestamp) {
                const sampleIndex = findNearestSampleIndex(samples, timestamp);
                return sampleIndex >= 0 ? '样本 ' + (sampleIndex + 1) : undefined;
            }

            function getEventsNearTimestamp(events, samples, timestamp) {
                if (!events.length) {
                    return [];
                }

                const tolerance = Math.max(getAverageSampleInterval(samples) * 0.75, 500);
                return events.filter((event) => Math.abs(event.timestamp - timestamp) <= tolerance);
            }

            function buildEventMarkerData(events, samples) {
                return events.map((event) => {
                    const displayText = getTimelineEventDisplayText(event);
                    const eventColor = event.color || '#7dd3fc';

                    return {
                        xAxis: event.timestamp,
                        eventText: displayText.length > 18
                            ? displayText.slice(0, 18) + '...'
                            : displayText,
                        eventFullText: displayText,
                        eventScreenshotPath: event.screenshotPath,
                        eventColor,
                        eventTypeLabel: getTimelineEventTypeLabel(event.type),
                        eventTimeLabel: formatMetaTime(event.timestamp),
                        eventSampleLabel: getEventSampleLabel(samples, event.timestamp),
                        lineStyle: {
                            color: eventColor,
                            width: 1.5,
                            opacity: 0.88
                        },
                        label: {
                            color: eventColor
                        }
                    };
                });
            }

            function renderTimelineEventList(params) {
                const {
                    host,
                    events,
                    samples,
                    onLocateTimestamp
                } = params;

                if (!host) {
                    return;
                }

                if (!Array.isArray(events) || events.length === 0) {
                    host.innerHTML =
                        '<div class="chartCard">' +
                            '<div class="chartHead">' +
                                '<strong>时间轴事件</strong>' +
                                '<span>当前会话暂无事件</span>' +
                            '</div>' +
                            '<p class="empty">未记录时间轴事件。</p>' +
                        '</div>';
                    return;
                }

                const sortedEvents = events.slice().sort((left, right) => {
                    if (left.timestamp !== right.timestamp) {
                        return left.timestamp - right.timestamp;
                    }

                    return (left.updatedAt || 0) - (right.updatedAt || 0);
                });
                const card = document.createElement('div');
                card.className = 'chartCard';
                card.innerHTML =
                    '<div class="chartHead">' +
                        '<strong>时间轴事件</strong>' +
                        '<span>' +
                            escapeHtml('共 ' + sortedEvents.length + ' 条，点击定位到对应时间点') +
                        '</span>' +
                    '</div>';

                const list = document.createElement('div');
                list.className = 'timelineEventList';

                sortedEvents.forEach((event) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'timelineEventItem';
                    const eventColor = event.color || '#7dd3fc';
                    const eventTypeLabel = getTimelineEventTypeLabel(event.type);
                    const eventText = getTimelineEventDisplayText(event) || '(无文本)';
                    const eventScreenshotPath =
                        typeof event.screenshotPath === 'string'
                            ? event.screenshotPath.trim()
                            : '';
                    const eventSampleLabel = getEventSampleLabel(
                        samples,
                        event.timestamp
                    );
                    const eventMetaParts = [
                        formatMetaTime(event.timestamp),
                        eventSampleLabel
                    ].filter(Boolean);

                    button.innerHTML =
                        '<div class="timelineEventItemHeader">' +
                            '<div class="timelineEventItemTitle">' +
                                '<span class="timelineEventColorDot" style="background:' + escapeHtml(eventColor) + ';"></span>' +
                                '<strong class="timelineEventType">' + escapeHtml(eventTypeLabel) + '</strong>' +
                            '</div>' +
                            '<span class="timelineEventMeta">' + escapeHtml(eventMetaParts.join(' | ')) + '</span>' +
                        '</div>' +
                        '<p class="timelineEventText">' + escapeHtml(eventText) + '</p>' +
                        (eventScreenshotPath
                            ? '<img class="timelineEventScreenshot" src="' + escapeHtml(eventScreenshotPath) + '" alt="event screenshot" />'
                            : '') +
                        '<span class="timelineEventLocate">定位到该时间点</span>';
                    button.addEventListener('click', () => {
                        const timestamp = Number(event.timestamp);

                        if (Number.isFinite(timestamp)) {
                            onLocateTimestamp(timestamp);
                        }
                    });
                    list.appendChild(button);
                });

                card.appendChild(list);
                host.innerHTML = '';
                host.appendChild(card);
            }

            function formatMarkerTooltip(data) {
                return renderTooltipSurface(
                    renderTooltipHeader({
                        eyebrow: 'Timeline Event',
                        title: data.eventTypeLabel || '事件',
                        meta: data.eventTimeLabel,
                        accentColor: data.eventColor
                    }) +
                        renderEventTooltipCard(data) +
                        '<div style="margin-top:8px;font-size:11px;color:#8ea1b7;">点击事件标记可定位到该时间点</div>'
                );
            }

            function formatAxisTooltip(params, events, samples) {
                const axisParams = Array.isArray(params) ? params : [params];
                if (!axisParams.length) {
                    return '';
                }

                const firstParam = axisParams[0] || {};
                const axisTimestamp = Array.isArray(firstParam.value)
                    ? Number(firstParam.value[0])
                    : Number(firstParam.axisValue);
                const relatedEvents = Number.isFinite(axisTimestamp)
                    ? getEventsNearTimestamp(events, samples, axisTimestamp)
                    : [];
                const sampleLabel = Number.isFinite(axisTimestamp)
                    ? getEventSampleLabel(samples, axisTimestamp)
                    : undefined;

                const metricRows = axisParams.map((item) => {
                    const rawValue = Array.isArray(item.value) ? item.value[1] : item.value;
                    return renderTooltipMetricRow(item.color || '#7dd3fc', item.seriesName || '指标', formatTooltipMetricValue(rawValue));
                });

                const sections = [
                    renderTooltipHeader({
                        eyebrow: 'Timeline Sample',
                        title: Number.isFinite(axisTimestamp) ? formatMetaTime(axisTimestamp) : '当前时间点',
                        meta: sampleLabel
                    }),
                    '<div style="display:grid;gap:0;">' + metricRows.join('') + '</div>'
                ];

                if (relatedEvents.length > 0) {
                    sections.push(
                        '<div style="display:grid;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(140, 160, 184, 0.18);">' +
                            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
                                renderTooltipBadge('关联事件') +
                                '<span style="font-size:11px;color:#8ea1b7;">' + relatedEvents.length + ' 条</span>' +
                            '</div>' +
                            relatedEvents.map((event) => renderEventTooltipCard({
                                eventColor: event.color,
                                eventTypeLabel: getTimelineEventTypeLabel(event.type),
                                eventTimeLabel: formatMetaTime(event.timestamp),
                                eventFullText: getTimelineEventDisplayText(event),
                                eventScreenshotPath: event.screenshotPath,
                                eventSampleLabel: getEventSampleLabel(samples, event.timestamp)
                            })).join('') +
                        '</div>'
                    );
                }

                return renderTooltipSurface(sections.join(''));
            }

            function createChartCard(host, config) {
                const card = document.createElement('div');
                card.className = 'chartCard';
                card.innerHTML =
                    '<div class="chartHead">' +
                        '<strong>' + escapeHtml(config.title) + '</strong>' +
                        '<span>' + escapeHtml(config.description || '') + '</span>' +
                    '</div>' +
                    (config.statsCard
                        ? '<div class="chartStatsMount"></div>'
                        : '') +
                    '<div class="chartSurface"></div>';
                host.appendChild(card);
                return {
                    chartSurface: card.querySelector('.chartSurface'),
                    chartStatsMount: card.querySelector('.chartStatsMount')
                };
            }

            function getCustomMetricDefinitionMap(report) {
                const map = new Map();
                (report.customMetricDefinitions || []).forEach((definition) => {
                    map.set(definition.key, definition);
                });
                return map;
            }

            function getSortedCustomSamples(report) {
                return (report.customSamples || []).slice().sort((left, right) => {
                    if (left.timestamp !== right.timestamp) {
                        return left.timestamp - right.timestamp;
                    }

                    if (left.receivedAt !== right.receivedAt) {
                        return left.receivedAt - right.receivedAt;
                    }

                    return (left.sequence || 0) - (right.sequence || 0);
                });
            }

            function getSortedCustomCharts(report) {
                return (report.customChartDefinitions || [])
                    .filter((definition) => Array.isArray(definition.metricKeys) && definition.metricKeys.length > 0)
                    .slice()
                    .sort((left, right) => {
                        const leftOrder = left.order == null ? Number.MAX_SAFE_INTEGER : left.order;
                        const rightOrder = right.order == null ? Number.MAX_SAFE_INTEGER : right.order;

                        if (leftOrder !== rightOrder) {
                            return leftOrder - rightOrder;
                        }

                        return String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN');
                    });
            }

            function getCustomChartValueTypeFromMap(chartDefinition, metricDefinitionMap) {
                const firstMetricKey = chartDefinition.metricKeys && chartDefinition.metricKeys[0];

                if (!firstMetricKey) {
                    return null;
                }

                const definition = metricDefinitionMap.get(firstMetricKey);
                return definition && definition.valueType ? definition.valueType : null;
            }

            function isStateValue(value) {
                return value === null || typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
            }

            function getStateValueKey(value) {
                if (value === null) {
                    return 'null';
                }

                if (typeof value === 'string') {
                    return 'string:' + value;
                }

                return 'string-list:' + JSON.stringify(value);
            }

            function formatStateValue(value) {
                if (value === null) {
                    return 'N/A';
                }

                if (typeof value === 'string') {
                    return value.length > 0 ? value : '(empty)';
                }

                return value.length > 0 ? value.join(', ') : '(empty list)';
            }

            function formatDurationLabel(durationMs) {
                if (durationMs <= 0) {
                    return 'single sample';
                }

                if (durationMs < 1000) {
                    return Math.round(durationMs) + ' ms';
                }

                if (durationMs < 60000) {
                    return (durationMs / 1000).toFixed(1) + ' s';
                }

                if (durationMs < 3600000) {
                    return (durationMs / 60000).toFixed(1) + ' min';
                }

                return (durationMs / 3600000).toFixed(1) + ' h';
            }

            function getSampleTimeDomain(samples) {
                if (!samples || samples.length === 0) {
                    return null;
                }

                const firstTimestamp = Number(samples[0] && samples[0].timestamp);
                const lastTimestamp = Number(samples[samples.length - 1] && samples[samples.length - 1].timestamp);

                if (!Number.isFinite(firstTimestamp) || !Number.isFinite(lastTimestamp) || lastTimestamp <= firstTimestamp) {
                    return null;
                }

                return {
                    startTimestamp: Math.floor(firstTimestamp),
                    endTimestamp: Math.ceil(lastTimestamp)
                };
            }

            function mergeTimeDomains(domains) {
                const validDomains = domains.filter(Boolean);

                if (!validDomains.length) {
                    return null;
                }

                return {
                    startTimestamp: Math.min.apply(
                        null,
                        validDomains.map((domain) => domain.startTimestamp)
                    ),
                    endTimestamp: Math.max.apply(
                        null,
                        validDomains.map((domain) => domain.endTimestamp)
                    )
                };
            }

            function buildSegmentFocusRange(segment, fullRange, averageSampleInterval) {
                if (!fullRange) {
                    return null;
                }

                const contextPadding = Math.max(250, Math.round(averageSampleInterval / 2));
                const minimumWindow = Math.max(1000, Math.round(averageSampleInterval));
                let startTimestamp = Math.floor(segment.startTimestamp - contextPadding);
                let endTimestamp = Math.ceil(segment.endTimestamp + contextPadding);

                if (endTimestamp - startTimestamp < minimumWindow) {
                    const centerTimestamp = (segment.startTimestamp + segment.endTimestamp) / 2;
                    startTimestamp = Math.floor(centerTimestamp - minimumWindow / 2);
                    endTimestamp = Math.ceil(centerTimestamp + minimumWindow / 2);
                }

                startTimestamp = Math.max(fullRange.startTimestamp, startTimestamp);
                endTimestamp = Math.min(fullRange.endTimestamp, endTimestamp);

                if (endTimestamp <= startTimestamp) {
                    return fullRange.endTimestamp > fullRange.startTimestamp
                        ? fullRange
                        : null;
                }

                return {
                    startTimestamp,
                    endTimestamp
                };
            }

            function getVisibleTimeRangeFromChart(chart, samples) {
                const fullRange = normalizeVisibleTimeRange(null, samples);

                if (!fullRange) {
                    return null;
                }

                if (!chart || typeof chart.getOption !== 'function') {
                    return fullRange;
                }

                const option = chart.getOption();
                const dataZoomArray = option && Array.isArray(option.dataZoom)
                    ? option.dataZoom
                    : [];

                for (const dataZoom of dataZoomArray) {
                    const startValue = Number(dataZoom && dataZoom.startValue);
                    const endValue = Number(dataZoom && dataZoom.endValue);

                    if (Number.isFinite(startValue) && Number.isFinite(endValue)) {
                        return normalizeVisibleTimeRange(
                            {
                                startTimestamp: startValue,
                                endTimestamp: endValue
                            },
                            samples
                        );
                    }
                }

                for (const dataZoom of dataZoomArray) {
                    const startPercent = Number(dataZoom && dataZoom.start);
                    const endPercent = Number(dataZoom && dataZoom.end);

                    if (
                        !Number.isFinite(startPercent) ||
                        !Number.isFinite(endPercent)
                    ) {
                        continue;
                    }

                    const span =
                        fullRange.endTimestamp - fullRange.startTimestamp;

                    return normalizeVisibleTimeRange(
                        {
                            startTimestamp:
                                fullRange.startTimestamp +
                                (span * startPercent) / 100,
                            endTimestamp:
                                fullRange.startTimestamp +
                                (span * endPercent) / 100
                        },
                        samples
                    );
                }

                return fullRange;
            }

            function updateChartStatsMount(params) {
                const {
                    chart,
                    config,
                    statsMount
                } = params;

                if (!statsMount || !config || !config.statsCard) {
                    return;
                }

                const samples = config.samples || [];
                const visibleTimeRange = getVisibleTimeRangeFromChart(
                    chart,
                    samples
                );
                const resolvedStatsCard = buildResolvedStatsCard({
                    statsCard: config.statsCard,
                    samples,
                    visibleTimeRange
                });

                statsMount.innerHTML = resolvedStatsCard
                    ? renderChartStatsPanel(resolvedStatsCard)
                    : '';
            }

            function getBuiltinLoadSeriesName(report, metricKey, fallbackName) {
                const isNormalizedCpuMode =
                    report &&
                    report.config &&
                    report.config.cpuMode === 'normalized';

                if (!isNormalizedCpuMode) {
                    return fallbackName;
                }

                if (metricKey === 'cpu') {
                    return 'App CPU Norm.(%)';
                }

                if (metricKey === 'cpuTotal') {
                    return 'Total CPU Norm.(%)';
                }

                return fallbackName;
            }

            function buildLoadChartStatsCard(report) {
                const samples = report.samples || [];
                const cpuMode = report && report.config ? report.config.cpuMode : null;
                const metricItems = [
                    {
                        key: 'cpu',
                        label:
                            cpuMode === 'normalized'
                                ? 'App CPU Norm.(%)'
                                : 'App CPU(%)',
                        unit: '%'
                    },
                    {
                        key: 'cpuTotal',
                        label:
                            cpuMode === 'normalized'
                                ? 'Total CPU Norm.(%)'
                                : 'Total CPU(%)',
                        unit: '%'
                    },
                    {
                        key: 'gpu',
                        label: 'GPU(%)',
                        unit: '%'
                    }
                ].map((item) => ({
                    source: 'builtin',
                    key: item.key,
                    label: item.label,
                    unit: item.unit,
                    computations: ['max', 'min', 'average']
                }));

                const hasAnyStats = metricItems.some(
                    (item) =>
                        collectBuiltinMetricValues(samples, item.key, null)
                            .length > 0
                );

                if (!hasAnyStats) {
                    return null;
                }

                return {
                    title: '负载统计',
                    scope: 'visible-range',
                    rangePrefix: '样本',
                    items: metricItems
                };
            }

            function buildCustomChartStatsCard(params) {
                const {
                    chartDefinition,
                    metricDefinitionMap,
                    samples
                } = params;
                const statsPolicy = chartDefinition.stats || {};

                if (!statsPolicy.enabled || statsPolicy.surface === 'monitor-only') {
                    return null;
                }

                const metricKeys = Array.isArray(statsPolicy.metricKeys) &&
                    statsPolicy.metricKeys.length > 0
                    ? statsPolicy.metricKeys.filter(Boolean)
                    : chartDefinition.metricKeys;

                if (!metricKeys.length) {
                    return null;
                }

                const computations = normalizeStatsComputations(
                    statsPolicy.computations
                );
                const items = metricKeys.map((metricKey) => {
                    const definition = metricDefinitionMap.get(metricKey) || {};

                    return {
                        source: 'custom',
                        key: metricKey,
                        label: definition.label || metricKey,
                        unit: definition.unit || '',
                        computations
                    };
                });
                const hasAnyStats = items.some(
                    (item) =>
                        collectCustomMetricValues(samples, item.key, null)
                            .length > 0
                );

                if (!hasAnyStats) {
                    return null;
                }

                return {
                    title: chartDefinition.title + ' 统计',
                    scope:
                        statsPolicy.scope === 'visible-range'
                            ? 'visible-range'
                            : 'whole-session',
                    rangePrefix: '自定义样本',
                    items
                };
            }

            function buildBuiltinChartConfigs(report) {
                const loadStatsCard = buildLoadChartStatsCard(report);

                return BUILTIN_CHARTS.map((chart) => ({
                    id: chart.id,
                    title: chart.title,
                    description: chart.description,
                    statsCard: chart.id === 'builtin-load' ? loadStatsCard : null,
                    samples: report.samples || [],
                    series: chart.series.map((series) => ({
                        type: 'line',
                        name:
                            chart.id === 'builtin-load'
                                ? getBuiltinLoadSeriesName(
                                    report,
                                    series.key,
                                    series.name
                                )
                                : series.name,
                        smooth: false,
                        showSymbol: false,
                        itemStyle: { color: series.color },
                        lineStyle: { color: series.color, width: 2 },
                        data: (report.samples || []).map((sample) => [sample.timestamp, sample.metrics && sample.metrics[series.key] ? sample.metrics[series.key].value : null])
                    }))
                }));
            }

            function buildCustomChartConfigs(report) {
                const metricDefinitionMap = getCustomMetricDefinitionMap(report);
                const customSamples = getSortedCustomSamples(report);

                return getSortedCustomCharts(report)
                    .filter((chartDefinition) => getCustomChartValueTypeFromMap(chartDefinition, metricDefinitionMap) === 'number')
                    .map((chartDefinition) => ({
                    id: chartDefinition.id,
                    title: chartDefinition.title,
                    description: chartDefinition.description || '自定义指标图表',
                    statsCard: buildCustomChartStatsCard({
                        chartDefinition,
                        metricDefinitionMap,
                        samples: customSamples
                    }),
                    samples: customSamples,
                    series: chartDefinition.metricKeys.map((metricKey, index) => {
                        const definition = metricDefinitionMap.get(metricKey) || {};
                        const color = definition.color || CUSTOM_COLORS[index % CUSTOM_COLORS.length];

                        return {
                            type: 'line',
                            name: definition.label || metricKey,
                            smooth: false,
                            showSymbol: false,
                            itemStyle: { color },
                            lineStyle: { color, width: 2 },
                            data: customSamples.map((sample) => [sample.timestamp, sample.values ? sample.values[metricKey] ?? null : null])
                        };
                    })
                })).filter((chart) => chart.series.length > 0);
            }

            function buildCustomStateConfigs(report) {
                const metricDefinitionMap = getCustomMetricDefinitionMap(report);
                const customSamples = getSortedCustomSamples(report);

                return getSortedCustomCharts(report)
                    .filter((chartDefinition) => getCustomChartValueTypeFromMap(chartDefinition, metricDefinitionMap) !== 'number')
                    .map((chartDefinition) => ({
                        chartDefinition,
                        tracks: (chartDefinition.metricKeys || []).map((metricKey, index) => {
                            const definition = metricDefinitionMap.get(metricKey);

                            if (!definition || (definition.valueType !== 'string' && definition.valueType !== 'string-list')) {
                                return null;
                            }

                            const color = definition.color || CUSTOM_COLORS[index % CUSTOM_COLORS.length];
                            const segments = [];
                            let currentSegment = null;

                            customSamples.forEach((sample) => {
                                const rawValue = sample.values ? sample.values[metricKey] : undefined;

                                if (!isStateValue(rawValue)) {
                                    currentSegment = null;
                                    return;
                                }

                                const value = Array.isArray(rawValue) ? rawValue.slice() : rawValue;
                                const valueKey = getStateValueKey(value);

                                if (currentSegment && currentSegment.valueKey === valueKey) {
                                    currentSegment.endTimestamp = sample.timestamp;
                                    currentSegment.sampleCount += 1;
                                    return;
                                }

                                currentSegment = {
                                    id: chartDefinition.id + ':' + metricKey + ':' + sample.timestamp + ':' + segments.length,
                                    metricKey,
                                    label: definition.label || metricKey,
                                    color,
                                    value,
                                    formattedValue: formatStateValue(value),
                                    valueKey,
                                    startTimestamp: sample.timestamp,
                                    endTimestamp: sample.timestamp,
                                    sampleCount: 1
                                };
                                segments.push(currentSegment);
                            });

                            if (!segments.length) {
                                return null;
                            }

                            return {
                                metricKey,
                                label: definition.label || metricKey,
                                color,
                                valueType: definition.valueType,
                                segments
                            };
                        }).filter(Boolean)
                    }))
                    .filter((config) => config.tracks.length > 0);
            }

            function createStateCard(host, config, onSegmentSelect) {
                const card = document.createElement('div');
                card.className = 'chartCard';
                card.innerHTML =
                    '<div class="chartHead">' +
                        '<strong>' + escapeHtml(config.chartDefinition.title) + '</strong>' +
                        '<span>' + escapeHtml(config.chartDefinition.description || '非数值自定义指标按区间展示。') + '</span>' +
                    '</div>';

                const trackStack = document.createElement('div');
                trackStack.className = 'stateTrackStack';

                config.tracks.forEach((track) => {
                    const trackNode = document.createElement('div');
                    trackNode.className = 'stateTrack';
                    trackNode.innerHTML =
                        '<div class="stateTrackHeader">' +
                            '<div class="stateTrackTitle">' +
                                '<span class="stateColorDot" style="background:' + escapeHtml(track.color) + ';"></span>' +
                                '<strong>' + escapeHtml(track.label) + '</strong>' +
                            '</div>' +
                            '<span class="stateTrackMeta">' + escapeHtml(track.valueType === 'string-list' ? 'String List' : 'String') + '</span>' +
                        '</div>';

                    if (track.segments.length > 0) {
                        const segmentList = document.createElement('div');
                        segmentList.className = 'stateSegmentList';

                        track.segments.forEach((segment) => {
                            const button = document.createElement('button');
                            button.type = 'button';
                            button.className = 'stateSegment';
                            button.style.setProperty('--segment-accent', segment.color);
                            button.innerHTML =
                                '<div class="stateSegmentHeader">' +
                                    '<span class="stateSegmentTime">' + escapeHtml(formatMetaTime(segment.startTimestamp) + (segment.startTimestamp === segment.endTimestamp ? '' : ' - ' + formatMetaTime(segment.endTimestamp))) + '</span>' +
                                    '<span class="stateSegmentCount">' + segment.sampleCount + ' sample' + (segment.sampleCount === 1 ? '' : 's') + '</span>' +
                                '</div>' +
                                '<strong class="stateSegmentValue">' + escapeHtml(segment.formattedValue) + '</strong>' +
                                '<span class="stateSegmentMeta">Duration: ' + escapeHtml(formatDurationLabel(segment.endTimestamp - segment.startTimestamp)) + '</span>';
                            button.addEventListener('click', () => {
                                onSegmentSelect(segment);
                            });
                            segmentList.appendChild(button);
                        });

                        trackNode.appendChild(segmentList);
                    } else {
                        const empty = document.createElement('p');
                        empty.className = 'stateEmpty';
                        empty.textContent = '暂无状态样本。';
                        trackNode.appendChild(empty);
                    }

                    trackStack.appendChild(trackNode);
                });

                card.appendChild(trackStack);
                host.appendChild(card);
            }

            function decorateSeriesWithEvents(series, events, samples) {
                if (!series.length || !events.length || !samples.length) {
                    return series;
                }

                return series.map((item, index) => index === 0
                    ? Object.assign({}, item, {
                        markLine: {
                            symbol: ['none', 'none'],
                            animation: false,
                            lineStyle: { width: 1.5 },
                            tooltip: {
                                appendToBody: true,
                                confine: true,
                                enterable: true,
                                backgroundColor: 'transparent',
                                borderWidth: 0,
                                padding: 0,
                                extraCssText: 'box-shadow:none;',
                                formatter: (params) => formatMarkerTooltip(params.data || {})
                            },
                            label: {
                                show: true,
                                position: 'insideEndTop',
                                fontSize: 10,
                                formatter: (params) => params.data && params.data.eventText ? params.data.eventText : '事件'
                            },
                            data: buildEventMarkerData(events, samples)
                        }
                    })
                    : item
                );
            }

            function updatePreview(report, timestamp) {
                const shot = document.getElementById('shot');
                const meta = document.getElementById('meta');

                if (!shot || !meta) {
                    return;
                }

                const sessionTitle = report.displayName || report.packageName;
                const samples = report.samples || [];
                const index = findNearestSampleIndex(samples, timestamp);
                const sample = index >= 0 ? samples[index] : null;

                if (!sample) {
                    meta.textContent = sessionTitle + ' | ' + report.serial;
                    shot.removeAttribute('src');
                    return;
                }

                meta.textContent = formatMetaTime(sample.timestamp) + ' | ' + sessionTitle + ' | ' + report.serial;

                if (sample.screenshotPath) {
                    shot.src = sample.screenshotPath;
                    return;
                }

                shot.removeAttribute('src');
            }

            function hasScreenshotSamples(samples) {
                return (samples || []).some((sample) =>
                    typeof sample.screenshotPath === 'string' &&
                    sample.screenshotPath.length > 0
                );
            }

            fetch('./report.json')
                .then((res) => res.json())
                .then((report) => {
                    const reportWrap = document.getElementById('reportWrap');
                    const chartHost = document.getElementById('charts');
                    const stateHost = document.getElementById('states');
                    const timelineEventsHost = document.getElementById('timelineEvents');
                    const previewPanel = document.getElementById('previewPanel');

                    renderSessionInfo(report);

                    const events = report.events || [];
                    const customSamples = getSortedCustomSamples(report);
                    const eventReferenceSamples = (report.samples || []).length > 0
                        ? report.samples || []
                        : customSamples;
                    const chartConfigs = buildBuiltinChartConfigs(report).concat(buildCustomChartConfigs(report));
                    const stateConfigs = buildCustomStateConfigs(report);
                    const chartInstances = [];
                    const previewEnabled = hasScreenshotSamples(report.samples || []);

                    if (!previewEnabled && previewPanel) {
                        previewPanel.remove();

                        if (reportWrap) {
                            reportWrap.classList.add('wrapNoPreview');
                        }
                    }

                    const reportTimeDomain = mergeTimeDomains([
                        getSampleTimeDomain(report.samples || []),
                        getSampleTimeDomain(customSamples),
                        getSampleTimeDomain(events)
                    ]);
                    const customAverageSampleInterval = getAverageSampleInterval(customSamples);

                    function focusChartsAtTimestamp(timestamp) {
                        chartInstances.forEach(({ chart, samples }) => {
                            const dataIndex = findNearestSampleIndex(samples, timestamp);
                            if (dataIndex >= 0) {
                                chart.dispatchAction({
                                    type: 'showTip',
                                    seriesIndex: 0,
                                    dataIndex
                                });
                            }
                        });

                        updatePreview(report, timestamp);
                    }

                    function focusChartsAtSegment(segment) {
                        const focusTimestamp = Math.floor((segment.startTimestamp + segment.endTimestamp) / 2);
                        const focusRange = buildSegmentFocusRange(
                            segment,
                            reportTimeDomain,
                            customAverageSampleInterval
                        );

                        if (focusRange) {
                            chartInstances.forEach(({ chart }) => {
                                chart.dispatchAction({
                                    type: 'dataZoom',
                                    startValue: focusRange.startTimestamp,
                                    endValue: focusRange.endTimestamp,
                                    escapeConnect: true
                                });
                            });
                        }

                        focusChartsAtTimestamp(focusTimestamp);
                    }

                    renderTimelineEventList({
                        host: timelineEventsHost,
                        events,
                        samples: eventReferenceSamples,
                        onLocateTimestamp: focusChartsAtTimestamp
                    });

                    if (!chartConfigs.length && !stateConfigs.length) {
                        chartHost.innerHTML = '<p class="empty">该历史会话暂无可导出的趋势图数据。</p>';
                        updatePreview(report, Date.now());
                        return;
                    }

                    chartConfigs.forEach((config) => {
                        const mountNodes = createChartCard(chartHost, config);

                        if (!mountNodes.chartSurface) {
                            return;
                        }

                        const chart = echarts.init(mountNodes.chartSurface);
                        chart.group = 'ly-perf-html-report-sync';
                        echarts.connect('ly-perf-html-report-sync');
                        chartInstances.push({ chart, samples: config.samples });

                        chart.setOption({
                            tooltip: {
                                trigger: 'axis',
                                appendToBody: true,
                                confine: true,
                                enterable: true,
                                backgroundColor: 'transparent',
                                borderWidth: 0,
                                padding: 0,
                                extraCssText: 'box-shadow:none;',
                                formatter: (params) => formatAxisTooltip(params, events, config.samples)
                            },
                            legend: {
                                top: 8,
                                textStyle: { color: '#cad5e2' }
                            },
                            grid: {
                                left: 56,
                                right: 24,
                                top: 48,
                                bottom: 70
                            },
                            xAxis: {
                                type: 'time',
                                axisLabel: {
                                    color: '#9db0c7',
                                    formatter: (value) => formatAxisTime(Number(value))
                                }
                            },
                            yAxis: {
                                type: 'value',
                                axisLabel: { color: '#9db0c7' },
                                splitLine: { lineStyle: { color: 'rgba(140,160,184,0.2)' } }
                            },
                            dataZoom: [
                                { type: 'inside', filterMode: 'none' },
                                { type: 'slider', filterMode: 'none', height: 24, bottom: 18 }
                            ],
                            series: decorateSeriesWithEvents(config.series, events, config.samples)
                        });

                        updateChartStatsMount({
                            chart,
                            config,
                            statsMount: mountNodes.chartStatsMount
                        });

                        chart.on('dataZoom', () => {
                            updateChartStatsMount({
                                chart,
                                config,
                                statsMount: mountNodes.chartStatsMount
                            });
                        });

                        chart.on('updateAxisPointer', (event) => {
                            const axisInfo = event.axesInfo && event.axesInfo[0];
                            if (!axisInfo) {
                                return;
                            }

                            const timestamp = Number(axisInfo.value);
                            if (Number.isFinite(timestamp)) {
                                updatePreview(report, timestamp);
                            }
                        });

                        chart.on('click', (params) => {
                            if (params.componentType !== 'markLine') {
                                return;
                            }

                            const timestamp = Number(params.data && params.data.xAxis);
                            if (!Number.isFinite(timestamp)) {
                                return;
                            }

                            focusChartsAtTimestamp(timestamp);
                        });
                    });

                    stateConfigs.forEach((config) => {
                        createStateCard(stateHost, config, focusChartsAtSegment);
                    });

                    const previewTimestamp = report.samples && report.samples.length > 0
                        ? report.samples[report.samples.length - 1].timestamp
                        : Date.now();
                    updatePreview(report, previewTimestamp);
                });
        </script>
    </body>
</html>
`;
    }
}
