import { promises as fs } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import type { ExportResult, SessionDetail } from "@shared/types";
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

function toWebPath(value: string): string {
    return value.split(path.sep).join("/");
}

export class ReportService {
    constructor(
        private readonly store: SessionStore,
        private readonly appRoot: string
    ) {}

    async exportSession(
        sessionId: string,
        format: "html" | "xlsx"
    ): Promise<ExportResult> {
        if (format === "html") {
            return this.exportHtml(sessionId);
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

    private async exportXlsx(sessionId: string): Promise<ExportResult> {
        const session = await this.store.getSession(sessionId);
        const outputDir = path.join(
            this.store.getDataDir(),
            "exports",
            sessionId,
            "xlsx"
        );

        await fs.mkdir(outputDir, { recursive: true });

        const rows = session.samples.map((sample) => {
            const row: Record<string, number | string | null> = {
                timestamp: new Date(sample.timestamp).toISOString(),
                screenshot: sample.screenshotPath ?? ""
            };

            for (const metricName of METRIC_NAMES) {
                row[metricName] = sample.metrics[metricName]?.value ?? null;
            }

            return row;
        });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const eventWorksheet = XLSX.utils.json_to_sheet(
            session.events.map((event) => ({
                id: event.id,
                timestamp: new Date(event.timestamp).toISOString(),
                type: event.type,
                color: event.color,
                text: event.text,
                createdAt: new Date(event.createdAt).toISOString(),
                updatedAt: new Date(event.updatedAt).toISOString()
            })),
            {
                header: [
                    "id",
                    "timestamp",
                    "type",
                    "color",
                    "text",
                    "createdAt",
                    "updatedAt"
                ]
            }
        );

        XLSX.utils.book_append_sheet(workbook, worksheet, "metrics");
        XLSX.utils.book_append_sheet(workbook, eventWorksheet, "events");

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

        const samples = await Promise.all(
            session.samples.map(async (sample, index) => {
                if (!sample.screenshotPath) {
                    return sample;
                }

                if (!copiedPathMap.has(sample.screenshotPath)) {
                    const ext = path.extname(sample.screenshotPath) || ".png";
                    const fileName = `${index.toString().padStart(6, "0")}${ext}`;
                    const targetPath = path.join(screenshotDir, fileName);

                    try {
                        await fs.copyFile(sample.screenshotPath, targetPath);
                        copiedPathMap.set(
                            sample.screenshotPath,
                            toWebPath(path.join("screenshots", fileName))
                        );
                    } catch {
                        copiedPathMap.set(sample.screenshotPath, "");
                    }
                }

                const copied =
                    copiedPathMap.get(sample.screenshotPath) || undefined;

                return {
                    ...sample,
                    screenshotPath: copied
                };
            })
        );

        return {
            ...session,
            samples
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
                background: radial-gradient(circle at 20% 20%, #2f4156, #18212d 60%, #10151f 100%);
                color: #dbe4ee;
                font-family: "Bahnschrift", "Trebuchet MS", sans-serif;
            }
            .wrap {
                display: grid;
                grid-template-columns: 2fr 1fr;
                gap: 12px;
                padding: 12px;
                min-height: 100vh;
                box-sizing: border-box;
            }
            .panel {
                background: rgba(10, 16, 24, 0.78);
                border: 1px solid rgba(102, 128, 153, 0.35);
                border-radius: 12px;
                overflow: hidden;
            }
            #chart {
                height: 82vh;
            }
            .preview {
                padding: 10px;
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
            }
            .title {
                margin: 0;
                padding: 12px;
                border-bottom: 1px solid rgba(102, 128, 153, 0.35);
                letter-spacing: 0.4px;
            }
        </style>
    </head>
    <body>
        <div class="wrap">
            <section class="panel">
                <h3 class="title">Performance Timeline</h3>
                <div id="chart"></div>
            </section>
            <section class="panel preview">
                <div id="meta" class="meta"></div>
                <img id="shot" alt="screenshot preview" />
            </section>
        </div>

        <script>
            const METRICS = [
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
            ];

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

            function renderTooltipSurface(content) {
                return "<div style=\"min-width:260px;max-width:340px;padding:14px 14px 12px;border:1px solid rgba(121, 151, 181, 0.28);border-radius:12px;background:linear-gradient(180deg, rgba(18, 28, 42, 0.98), rgba(8, 14, 23, 0.96));box-shadow:0 16px 42px rgba(0, 0, 0, 0.34);backdrop-filter:blur(8px);\">" + content + "</div>";
            }

            function renderTooltipColorDot(color, size) {
                const dotSize = size || 10;
                return "<span style=\"display:inline-block;width:" + dotSize + "px;height:" + dotSize + "px;border-radius:999px;background:" + escapeHtml(color || "#7dd3fc") + ";box-shadow:0 0 0 1px rgba(255, 255, 255, 0.18) inset;\"></span>";
            }

            function renderTooltipBadge(label, color) {
                return "<span style=\"display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid rgba(146, 173, 198, 0.24);background:rgba(21, 33, 47, 0.78);font-size:10px;color:" + escapeHtml(color || "#dbe7f6") + ";\">" + escapeHtml(label) + "</span>";
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

            function renderEventTooltipCard(data) {
                const metaParts = [data.eventTimeLabel, data.eventSampleLabel].filter(Boolean);

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
                    '</div>'
                ].join('');
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

            function getEventSampleLabel(samples, timestamp) {
                const sampleIndex = findNearestSampleIndex(samples, timestamp);

                return sampleIndex >= 0 ? "样本 " + (sampleIndex + 1) : undefined;
            }

            function formatMarkerTooltip(data) {
                return renderTooltipSurface(
                    renderTooltipHeader({
                        eyebrow: 'Timeline Event',
                        title: data.eventTypeLabel || '事件',
                        meta: data.eventTimeLabel,
                        accentColor: data.eventColor
                    }) +
                    renderEventTooltipCard(data)
                );
            }

            fetch("./report.json")
                .then((res) => res.json())
                .then((report) => {
                    const chart = echarts.init(document.getElementById("chart"));
                    const events = report.events || [];

                    const series = METRICS.map((name, index) => ({
                        type: "line",
                        name,
                        smooth: false,
                        showSymbol: false,
                        data: report.samples.map((sample) => [sample.timestamp, sample.metrics?.[name]?.value ?? null]),
                        markLine: index === 0 && events.length > 0
                            ? {
                                symbol: ["none", "none"],
                                animation: false,
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
                                    formatter: (params) => formatMarkerTooltip(params.data || {})
                                },
                                label: {
                                    show: true,
                                    position: "insideEndTop",
                                    fontSize: 10,
                                    formatter: (params) => params.data?.eventText || "事件"
                                },
                                data: events.map((event) => ({
                                    xAxis: event.timestamp,
                                    eventText: event.text.length > 18 ? event.text.slice(0, 18) + "..." : event.text,
                                    eventFullText: event.text,
                                    eventColor: event.color,
                                    eventTypeLabel: getTimelineEventTypeLabel(event.type),
                                    eventTimeLabel: formatMetaTime(event.timestamp),
                                    eventSampleLabel: getEventSampleLabel(report.samples, event.timestamp),
                                    lineStyle: {
                                        color: event.color,
                                        width: 1.5,
                                        opacity: 0.88
                                    },
                                    label: {
                                        color: event.color
                                    }
                                }))
                            }
                            : undefined
                    }));

                    chart.setOption({
                        tooltip: {
                            trigger: "axis"
                        },
                        legend: {
                            top: 8,
                            textStyle: {
                                color: "#cad5e2"
                            }
                        },
                        grid: {
                            left: 56,
                            right: 24,
                            top: 48,
                            bottom: 70
                        },
                        xAxis: {
                            type: "time",
                            axisLabel: {
                                color: "#9db0c7",
                                formatter: (value) => formatAxisTime(Number(value))
                            }
                        },
                        yAxis: {
                            type: "value",
                            axisLabel: { color: "#9db0c7" },
                            splitLine: { lineStyle: { color: "rgba(140,160,184,0.2)" } }
                        },
                        dataZoom: [
                            { type: "inside", filterMode: "none" },
                            { type: "slider", filterMode: "none", height: 24, bottom: 18 }
                        ],
                        series
                    });

                    const shot = document.getElementById("shot");
                    const meta = document.getElementById("meta");
                    const sessionTitle = report.displayName || report.packageName;

                    chart.on("updateAxisPointer", (event) => {
                        const axisInfo = event.axesInfo && event.axesInfo[0];
                        if (!axisInfo) {
                            return;
                        }

                        const index = findNearestSampleIndex(
                            report.samples,
                            Number(axisInfo.value)
                        );
                        const sample = report.samples[index];
                        if (!sample) {
                            return;
                        }

                        meta.textContent =
                            formatMetaTime(sample.timestamp) +
                            " | " +
                            sessionTitle +
                            " | " +
                            report.serial;

                        if (sample.screenshotPath) {
                            shot.src = sample.screenshotPath;
                        }
                    });
                });
        </script>
    </body>
</html>
`;
    }
}
