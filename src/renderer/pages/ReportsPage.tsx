import { useEffect, useMemo, useState } from "react";
import type {
    ExportResult,
    MetricName,
    SessionDetail,
    SessionSummary
} from "@shared/types";
import { ConfirmDialog } from "@renderer/components/ConfirmDialog";
import { MetricChart } from "@renderer/components/MetricChart";
import { PromptDialog } from "@renderer/components/PromptDialog";
import { SessionPersistenceBadge } from "@renderer/components/SessionPersistenceBadge";
import styles from "../styles/ReportsPage.module.css";

type BusyAction = "delete" | "export-html" | "export-xlsx" | "rename";

interface FeedbackState {
    type: "error" | "success";
    text: string;
}

interface VisibleRange {
    startIndex: number;
    endIndex: number;
}

interface MetricStats {
    min: number;
    max: number;
    average: number;
}

function formatDate(ts: number): string {
    return new Date(ts).toLocaleString();
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallback;
}

function formatMetricValue(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatTraffic(totalTrafficMb: number | null | undefined): string {
    if (totalTrafficMb === null || totalTrafficMb === undefined) {
        return "N/A";
    }

    if (totalTrafficMb >= 1024) {
        return `${formatMetricValue(totalTrafficMb / 1024)} GB`;
    }

    return `${formatMetricValue(totalTrafficMb)} MB`;
}

function formatStatValue(value: number | null): string {
    if (value === null) {
        return "N/A";
    }

    return `${formatMetricValue(value)} %`;
}

function getPersistenceDescription(
    session: SessionSummary | SessionDetail
): string {
    if (session.persistenceState === "recovered") {
        return "该会话由 append-only journal 恢复，可能缺少异常退出前最后一小段未完成写盘的数据。";
    }

    return "该会话已完成正常落盘，可直接查看、导出和管理。";
}

function normalizeVisibleRange(
    range: VisibleRange | null,
    sampleCount: number
): VisibleRange | null {
    if (sampleCount <= 0) {
        return null;
    }

    if (!range) {
        return {
            startIndex: 0,
            endIndex: sampleCount - 1
        };
    }

    const maxIndex = sampleCount - 1;

    return {
        startIndex: Math.max(0, Math.min(maxIndex, range.startIndex)),
        endIndex: Math.max(
            0,
            Math.min(maxIndex, Math.max(range.startIndex, range.endIndex))
        )
    };
}

function calculateMetricStats(
    sessionDetail: SessionDetail | null,
    range: VisibleRange | null,
    metricName: MetricName
): MetricStats | null {
    const normalizedRange = normalizeVisibleRange(
        range,
        sessionDetail?.samples.length ?? 0
    );

    if (!sessionDetail || !normalizedRange) {
        return null;
    }

    const values = sessionDetail.samples
        .slice(normalizedRange.startIndex, normalizedRange.endIndex + 1)
        .map((sample) => sample.metrics[metricName])
        .filter((metric) => metric?.available && metric.value !== null)
        .map((metric) => metric.value as number);

    if (values.length === 0) {
        return null;
    }

    const total = values.reduce((sum, value) => sum + value, 0);

    return {
        min: Math.min(...values),
        max: Math.max(...values),
        average: total / values.length
    };
}

function findNearestIndex(indexes: number[], target: number): number {
    if (indexes.length === 0) {
        return -1;
    }

    let low = 0;
    let high = indexes.length - 1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const value = indexes[middle];

        if (value === target) {
            return middle;
        }

        if (value < target) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    if (low >= indexes.length) {
        return indexes.length - 1;
    }

    if (high < 0) {
        return 0;
    }

    const nextDistance = Math.abs(indexes[low] - target);
    const previousDistance = Math.abs(indexes[high] - target);

    return previousDistance <= nextDistance ? high : low;
}

export function ReportsPage() {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState("");
    const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(
        null
    );
    const [exportResult, setExportResult] = useState<ExportResult | null>(null);
    const [feedback, setFeedback] = useState<FeedbackState | null>(null);
    const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [renameDialogError, setRenameDialogError] = useState<string | null>(
        null
    );
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [selectedScreenshotPosition, setSelectedScreenshotPosition] =
        useState(-1);
    const [selectedScreenshotUrl, setSelectedScreenshotUrl] = useState("");
    const [isScreenshotLoading, setIsScreenshotLoading] = useState(false);
    const [loadChartRange, setLoadChartRange] = useState<VisibleRange | null>(
        null
    );

    const controlsDisabled =
        refreshing ||
        busyAction !== null ||
        renameDialogOpen ||
        deleteDialogOpen;
    const latestMetrics =
        sessionDetail?.samples[sessionDetail.samples.length - 1]?.metrics;
    const chartSyncGroup = sessionDetail
        ? `report-metric-charts-${sessionDetail.id}`
        : undefined;
    const screenshotSampleIndexes = useMemo(() => {
        if (!sessionDetail) {
            return [] as number[];
        }

        return sessionDetail.samples.reduce<number[]>(
            (result, sample, index) => {
                if (sample.screenshotPath) {
                    result.push(index);
                }

                return result;
            },
            []
        );
    }, [sessionDetail]);
    const selectedScreenshotSampleIndex =
        selectedScreenshotPosition >= 0
            ? (screenshotSampleIndexes[selectedScreenshotPosition] ?? null)
            : null;
    const selectedScreenshotSample =
        selectedScreenshotSampleIndex !== null && sessionDetail
            ? (sessionDetail.samples[selectedScreenshotSampleIndex] ?? null)
            : null;
    const normalizedLoadChartRange = useMemo(
        () =>
            normalizeVisibleRange(
                loadChartRange,
                sessionDetail?.samples.length ?? 0
            ),
        [loadChartRange, sessionDetail]
    );
    const loadChartStats = useMemo(
        () => [
            {
                label:
                    sessionDetail?.config.cpuMode === "normalized"
                        ? "App CPU Norm.(%)"
                        : "App CPU(%)",
                stats: calculateMetricStats(
                    sessionDetail,
                    normalizedLoadChartRange,
                    "cpu"
                )
            },
            {
                label:
                    sessionDetail?.config.cpuMode === "normalized"
                        ? "Total CPU Norm.(%)"
                        : "Total CPU(%)",
                stats: calculateMetricStats(
                    sessionDetail,
                    normalizedLoadChartRange,
                    "cpuTotal"
                )
            },
            {
                label: "GPU(%)",
                stats: calculateMetricStats(
                    sessionDetail,
                    normalizedLoadChartRange,
                    "gpu"
                )
            }
        ],
        [normalizedLoadChartRange, sessionDetail]
    );

    async function reloadSessions(): Promise<void> {
        setRefreshing(true);

        try {
            const list = await window.lyPerf.listSessions();
            setSessions(list);

            setSelectedSessionId((current) => {
                if (current && list.some((item) => item.id === current)) {
                    return current;
                }

                return list[0]?.id ?? "";
            });
        } catch (error) {
            setFeedback({
                type: "error",
                text: getErrorMessage(error, "加载历史会话失败。")
            });
        } finally {
            setRefreshing(false);
        }
    }

    useEffect(() => {
        void reloadSessions();
    }, []);

    useEffect(() => {
        if (!selectedSessionId) {
            setSessionDetail(null);
            setExportResult(null);
            return;
        }

        let cancelled = false;

        void (async () => {
            try {
                const detail =
                    await window.lyPerf.getSession(selectedSessionId);
                if (cancelled) {
                    return;
                }

                setSessionDetail(detail);
                setExportResult(null);
            } catch (error) {
                if (cancelled) {
                    return;
                }

                setSessionDetail(null);
                setExportResult(null);
                setFeedback({
                    type: "error",
                    text: getErrorMessage(error, "加载历史会话详情失败。")
                });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [selectedSessionId]);

    useEffect(() => {
        if (screenshotSampleIndexes.length === 0) {
            setSelectedScreenshotPosition(-1);
            return;
        }

        setSelectedScreenshotPosition(screenshotSampleIndexes.length - 1);
    }, [screenshotSampleIndexes]);

    useEffect(() => {
        setLoadChartRange(
            sessionDetail && sessionDetail.samples.length > 0
                ? { startIndex: 0, endIndex: sessionDetail.samples.length - 1 }
                : null
        );
    }, [sessionDetail]);

    useEffect(() => {
        let disposed = false;
        const screenshotPath = selectedScreenshotSample?.screenshotPath;

        if (!screenshotPath) {
            setSelectedScreenshotUrl("");
            setIsScreenshotLoading(false);
            return () => {
                disposed = true;
            };
        }

        setIsScreenshotLoading(true);

        void (async () => {
            try {
                const dataUrl =
                    await window.lyPerf.readScreenshotDataUrl(screenshotPath);
                if (!disposed) {
                    setSelectedScreenshotUrl(dataUrl ?? "");
                    setIsScreenshotLoading(false);
                }
            } catch {
                if (!disposed) {
                    setSelectedScreenshotUrl("");
                    setIsScreenshotLoading(false);
                }
            }
        })();

        return () => {
            disposed = true;
        };
    }, [selectedScreenshotSample]);

    async function handleExport(format: "html" | "xlsx"): Promise<void> {
        if (!selectedSessionId) {
            return;
        }

        setBusyAction(format === "html" ? "export-html" : "export-xlsx");

        try {
            const result = await window.lyPerf.exportSession(
                selectedSessionId,
                format
            );
            setExportResult(result);
            setFeedback(null);
        } catch (error) {
            setFeedback({
                type: "error",
                text: getErrorMessage(error, "导出历史会话失败。")
            });
        } finally {
            setBusyAction(null);
        }
    }

    function openRenameDialog(): void {
        if (!sessionDetail) {
            return;
        }

        setRenameDialogError(null);
        setRenameDialogOpen(true);
    }

    function closeRenameDialog(): void {
        if (busyAction === "rename") {
            return;
        }

        setRenameDialogError(null);
        setRenameDialogOpen(false);
    }

    async function handleRename(nextName: string): Promise<void> {
        if (!sessionDetail) {
            return;
        }

        const normalizedName = nextName.trim();
        if (!normalizedName) {
            setRenameDialogError("会话名称不能为空。");
            return;
        }

        if (normalizedName === sessionDetail.displayName) {
            closeRenameDialog();
            return;
        }

        setBusyAction("rename");

        try {
            const renamed = await window.lyPerf.renameSession(
                sessionDetail.id,
                normalizedName
            );
            setSessionDetail(renamed);
            setSessions((current) =>
                current.map((session) =>
                    session.id === renamed.id
                        ? {
                              ...session,
                              displayName: renamed.displayName,
                              packageName: renamed.packageName
                          }
                        : session
                )
            );
            setRenameDialogError(null);
            setRenameDialogOpen(false);
            setFeedback({
                type: "success",
                text: `已将历史会话重命名为 ${renamed.displayName}。`
            });
        } catch (error) {
            setRenameDialogError(
                getErrorMessage(error, "重命名历史会话失败。")
            );
        } finally {
            setBusyAction(null);
        }
    }

    function openDeleteDialog(): void {
        if (!sessionDetail) {
            return;
        }

        setDeleteDialogOpen(true);
    }

    function closeDeleteDialog(): void {
        if (busyAction === "delete") {
            return;
        }

        setDeleteDialogOpen(false);
    }

    async function handleDelete(): Promise<void> {
        if (!sessionDetail) {
            return;
        }

        setBusyAction("delete");

        try {
            await window.lyPerf.deleteSession(sessionDetail.id);
            setDeleteDialogOpen(false);
            setSessionDetail(null);
            setExportResult(null);
            setFeedback({
                type: "success",
                text: `已删除历史会话 ${sessionDetail.displayName}。`
            });
            await reloadSessions();
        } catch (error) {
            setFeedback({
                type: "error",
                text: getErrorMessage(error, "删除历史会话失败。")
            });
        } finally {
            setBusyAction(null);
        }
    }

    function handleChartSampleFocus(sampleIndex: number): void {
        if (screenshotSampleIndexes.length === 0) {
            return;
        }

        const nextPosition = findNearestIndex(
            screenshotSampleIndexes,
            sampleIndex
        );
        setSelectedScreenshotPosition((current) =>
            current === nextPosition ? current : nextPosition
        );
    }

    function jumpScreenshot(offset: -1 | 1): void {
        setSelectedScreenshotPosition((current) => {
            if (screenshotSampleIndexes.length === 0) {
                return -1;
            }

            if (current < 0) {
                return offset > 0 ? 0 : screenshotSampleIndexes.length - 1;
            }

            const next = current + offset;
            if (next < 0 || next >= screenshotSampleIndexes.length) {
                return current;
            }

            return next;
        });
    }

    return (
        <section className={styles.page}>
            <aside className={styles.sidebar}>
                <div className={styles.headerRow}>
                    <h3>历史会话</h3>
                    <button
                        type="button"
                        disabled={controlsDisabled}
                        onClick={() => void reloadSessions()}
                    >
                        {refreshing ? "刷新中..." : "刷新"}
                    </button>
                </div>

                <ul className={styles.sessionList}>
                    {sessions.length === 0 ? (
                        <li className={styles.empty}>暂无历史会话</li>
                    ) : null}

                    {sessions.map((session) => (
                        <li key={session.id}>
                            <button
                                type="button"
                                disabled={controlsDisabled}
                                className={
                                    selectedSessionId === session.id
                                        ? styles.sessionActive
                                        : styles.sessionBtn
                                }
                                onClick={() => setSelectedSessionId(session.id)}
                            >
                                <div className={styles.sessionTitleRow}>
                                    <div className={styles.sessionTitle}>
                                        {session.displayName}
                                    </div>
                                    <SessionPersistenceBadge
                                        state={session.persistenceState}
                                        compact
                                    />
                                </div>
                                {session.displayName !== session.packageName ? (
                                    <div className={styles.sessionMeta}>
                                        包名: {session.packageName}
                                    </div>
                                ) : null}
                                <div className={styles.sessionMeta}>
                                    {session.serial}
                                </div>
                                <div className={styles.sessionMeta}>
                                    开始: {formatDate(session.startedAt)}
                                </div>
                                <div className={styles.sessionMeta}>
                                    样本: {session.sampleCount}
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            </aside>

            <div className={styles.content}>
                {feedback ? (
                    <p
                        className={
                            feedback.type === "error"
                                ? styles.errorMessage
                                : styles.statusMessage
                        }
                    >
                        {feedback.text}
                    </p>
                ) : null}

                {sessionDetail ? (
                    <>
                        <header className={styles.detailHeader}>
                            <div>
                                <div className={styles.detailTitleRow}>
                                    <h3>{sessionDetail.displayName}</h3>
                                    <SessionPersistenceBadge
                                        state={sessionDetail.persistenceState}
                                    />
                                </div>
                                <p>
                                    包名 {sessionDetail.packageName} | 设备{" "}
                                    {sessionDetail.deviceInfo.brand}{" "}
                                    {sessionDetail.deviceInfo.model} (
                                    {sessionDetail.serial})
                                </p>
                            </div>
                            <div className={styles.detailActions}>
                                <div className={styles.exportButtons}>
                                    <button
                                        type="button"
                                        disabled={controlsDisabled}
                                        onClick={openRenameDialog}
                                    >
                                        重命名
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.dangerButton}
                                        disabled={controlsDisabled}
                                        onClick={openDeleteDialog}
                                    >
                                        删除
                                    </button>
                                </div>
                                <div className={styles.exportButtons}>
                                    <button
                                        type="button"
                                        disabled={controlsDisabled}
                                        onClick={() =>
                                            void handleExport("html")
                                        }
                                    >
                                        导出 HTML
                                    </button>
                                    <button
                                        type="button"
                                        disabled={controlsDisabled}
                                        onClick={() =>
                                            void handleExport("xlsx")
                                        }
                                    >
                                        导出 XLSX
                                    </button>
                                </div>
                            </div>
                        </header>

                        {exportResult ? (
                            <p className={styles.exportResult}>
                                已导出 {exportResult.format.toUpperCase()} 报告:{" "}
                                {exportResult.outputPath}
                            </p>
                        ) : null}

                        {sessionDetail.persistenceState === "recovered" ? (
                            <div className={styles.recoveryNotice}>
                                <strong>恢复态会话</strong>
                                <span>
                                    {getPersistenceDescription(sessionDetail)}
                                </span>
                            </div>
                        ) : null}

                        <div className={styles.summaryGrid}>
                            <div>
                                <span>会话状态</span>
                                <strong>
                                    {sessionDetail.persistenceState ===
                                    "recovered"
                                        ? "Journal 恢复"
                                        : "已完成落盘"}
                                </strong>
                            </div>
                            <div>
                                <span>开始时间</span>
                                <strong>
                                    {formatDate(sessionDetail.startedAt)}
                                </strong>
                            </div>
                            <div>
                                <span>结束时间</span>
                                <strong>
                                    {formatDate(sessionDetail.endedAt)}
                                </strong>
                            </div>
                            <div>
                                <span>采样总数</span>
                                <strong>{sessionDetail.sampleCount}</strong>
                            </div>
                            <div>
                                <span>截图策略</span>
                                <strong>
                                    {sessionDetail.config.screenshotEnabled
                                        ? "开启"
                                        : "关闭"}
                                </strong>
                            </div>
                            <div>
                                <span>FPS来源</span>
                                <strong>
                                    {sessionDetail.config.fpsMode === "gfxinfo"
                                        ? "gfxinfo"
                                        : "SurfaceFlinger"}
                                </strong>
                            </div>
                            <div>
                                <span>CPU口径</span>
                                <strong>
                                    {sessionDetail.config.cpuMode ===
                                    "normalized"
                                        ? "CPU Usage (Normalized)"
                                        : "CPU Usage（传统）"}
                                </strong>
                            </div>
                            <div>
                                <span>总流量</span>
                                <strong>
                                    {formatTraffic(
                                        latestMetrics?.networkTotal?.value
                                    )}
                                </strong>
                            </div>
                        </div>
                        <div className={styles.detailBody}>
                            <section className={styles.chartSection}>
                                <div className={styles.sectionHeader}>
                                    <h4>历史趋势图</h4>
                                    <span>
                                        保留完整采样序列，布局与实时监控一致，缩放区域联动。
                                    </span>
                                </div>

                                {sessionDetail.samples.length > 0 ? (
                                    <div className={styles.chartStack}>
                                        <MetricChart
                                            title="帧率（FPS）"
                                            samples={sessionDetail.samples}
                                            syncGroup={chartSyncGroup}
                                            onSampleFocus={
                                                handleChartSampleFocus
                                            }
                                            series={[
                                                {
                                                    name: "FPS",
                                                    key: "fps",
                                                    color: "#e24a6e"
                                                },
                                                {
                                                    name: "Jank",
                                                    key: "jank",
                                                    color: "#f4b860"
                                                },
                                                {
                                                    name: "Big Jank",
                                                    key: "bigJank",
                                                    color: "#ff7a59"
                                                }
                                            ]}
                                        />

                                        <MetricChart
                                            title="负载（App CPU / Total CPU / GPU）"
                                            samples={sessionDetail.samples}
                                            syncGroup={chartSyncGroup}
                                            onSampleFocus={
                                                handleChartSampleFocus
                                            }
                                            onVisibleRangeChange={(
                                                startIndex,
                                                endIndex
                                            ) => {
                                                setLoadChartRange((current) =>
                                                    current &&
                                                    current.startIndex ===
                                                        startIndex &&
                                                    current.endIndex ===
                                                        endIndex
                                                        ? current
                                                        : {
                                                              startIndex,
                                                              endIndex
                                                          }
                                                );
                                            }}
                                            series={[
                                                {
                                                    name:
                                                        sessionDetail.config
                                                            .cpuMode ===
                                                        "normalized"
                                                            ? "App CPU Norm.(%)"
                                                            : "App CPU(%)",
                                                    key: "cpu",
                                                    color: "#5ca6ff"
                                                },
                                                {
                                                    name:
                                                        sessionDetail.config
                                                            .cpuMode ===
                                                        "normalized"
                                                            ? "Total CPU Norm.(%)"
                                                            : "Total CPU(%)",
                                                    key: "cpuTotal",
                                                    color: "#59d6d6"
                                                },
                                                {
                                                    name: "GPU(%)",
                                                    key: "gpu",
                                                    color: "#7bd389"
                                                }
                                            ]}
                                        />

                                        <div
                                            className={styles.metricStatsPanel}
                                        >
                                            <div
                                                className={
                                                    styles.metricStatsHeader
                                                }
                                            >
                                                <strong>
                                                    当前选择区域统计
                                                </strong>
                                                <span>
                                                    {normalizedLoadChartRange
                                                        ? `样本 ${normalizedLoadChartRange.startIndex + 1} - ${normalizedLoadChartRange.endIndex + 1}`
                                                        : "暂无可统计数据"}
                                                </span>
                                            </div>

                                            <div
                                                className={
                                                    styles.metricStatsGrid
                                                }
                                            >
                                                {loadChartStats.map((item) => (
                                                    <div
                                                        key={item.label}
                                                        className={
                                                            styles.metricStatsCard
                                                        }
                                                    >
                                                        <strong>
                                                            {item.label}
                                                        </strong>
                                                        <span>
                                                            最大值{" "}
                                                            {formatStatValue(
                                                                item.stats
                                                                    ?.max ??
                                                                    null
                                                            )}
                                                        </span>
                                                        <span>
                                                            最小值{" "}
                                                            {formatStatValue(
                                                                item.stats
                                                                    ?.min ??
                                                                    null
                                                            )}
                                                        </span>
                                                        <span>
                                                            平均值{" "}
                                                            {formatStatValue(
                                                                item.stats
                                                                    ?.average ??
                                                                    null
                                                            )}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <MetricChart
                                            title="内存细分（MB）"
                                            samples={sessionDetail.samples}
                                            syncGroup={chartSyncGroup}
                                            onSampleFocus={
                                                handleChartSampleFocus
                                            }
                                            series={[
                                                {
                                                    name: "PSS Total",
                                                    key: "memory",
                                                    color: "#f4b860"
                                                },
                                                {
                                                    name: "Graphics",
                                                    key: "memoryGraphics",
                                                    color: "#4fc3f7"
                                                },
                                                {
                                                    name: "Native Heap",
                                                    key: "memoryNativeHeap",
                                                    color: "#81c784"
                                                },
                                                {
                                                    name: "Private Other",
                                                    key: "memoryPrivateOther",
                                                    color: "#ff8a65"
                                                }
                                            ]}
                                        />

                                        <MetricChart
                                            title="资源吞吐（网络上下行速率 / 磁盘）"
                                            samples={sessionDetail.samples}
                                            syncGroup={chartSyncGroup}
                                            onSampleFocus={
                                                handleChartSampleFocus
                                            }
                                            series={[
                                                {
                                                    name: "下行 KB/s",
                                                    key: "networkRx",
                                                    color: "#4dd0e1"
                                                },
                                                {
                                                    name: "上行 KB/s",
                                                    key: "networkTx",
                                                    color: "#26a69a"
                                                },
                                                {
                                                    name: "Disk Read",
                                                    key: "diskRead",
                                                    color: "#ab47bc"
                                                },
                                                {
                                                    name: "Disk Write",
                                                    key: "diskWrite",
                                                    color: "#7e57c2"
                                                }
                                            ]}
                                        />

                                        <MetricChart
                                            title="温度与功耗"
                                            samples={sessionDetail.samples}
                                            syncGroup={chartSyncGroup}
                                            onSampleFocus={
                                                handleChartSampleFocus
                                            }
                                            series={[
                                                {
                                                    name: "Temperature(°C)",
                                                    key: "temperature",
                                                    color: "#ff7043"
                                                },
                                                {
                                                    name: "Power(mA)",
                                                    key: "power",
                                                    color: "#ffee58"
                                                }
                                            ]}
                                        />
                                    </div>
                                ) : (
                                    <p className={styles.empty}>
                                        该历史会话暂无采样数据，暂时无法绘制趋势图。
                                    </p>
                                )}
                            </section>

                            <section className={styles.previewSection}>
                                <div className={styles.sectionHeader}>
                                    <h4>截图预览</h4>
                                    <span>
                                        悬停或点击趋势图，会自动跳到最近一张截图。
                                    </span>
                                </div>

                                {selectedScreenshotSample ? (
                                    <>
                                        <div className={styles.previewToolbar}>
                                            <div className={styles.previewMeta}>
                                                <strong>
                                                    {formatDate(
                                                        selectedScreenshotSample.timestamp
                                                    )}
                                                </strong>
                                                <span>
                                                    第{" "}
                                                    {selectedScreenshotPosition +
                                                        1}{" "}
                                                    /{" "}
                                                    {
                                                        screenshotSampleIndexes.length
                                                    }{" "}
                                                    张截图
                                                </span>
                                            </div>

                                            <div
                                                className={
                                                    styles.previewActions
                                                }
                                            >
                                                <button
                                                    type="button"
                                                    disabled={
                                                        selectedScreenshotPosition <=
                                                        0
                                                    }
                                                    onClick={() =>
                                                        jumpScreenshot(-1)
                                                    }
                                                >
                                                    上一张
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={
                                                        selectedScreenshotPosition <
                                                            0 ||
                                                        selectedScreenshotPosition >=
                                                            screenshotSampleIndexes.length -
                                                                1
                                                    }
                                                    onClick={() =>
                                                        jumpScreenshot(1)
                                                    }
                                                >
                                                    下一张
                                                </button>
                                            </div>
                                        </div>

                                        {selectedScreenshotUrl ? (
                                            <img
                                                className={styles.previewImage}
                                                src={selectedScreenshotUrl}
                                                alt={`session screenshot at ${formatDate(selectedScreenshotSample.timestamp)}`}
                                            />
                                        ) : isScreenshotLoading ? (
                                            <p className={styles.empty}>
                                                截图加载中...
                                            </p>
                                        ) : (
                                            <p className={styles.empty}>
                                                截图加载失败，文件可能已不存在或不可访问。
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <p className={styles.empty}>
                                        该历史会话没有可预览截图。开启截图采样后再开始监控即可保留历史截图。
                                    </p>
                                )}
                            </section>
                        </div>
                    </>
                ) : (
                    <p className={styles.empty}>
                        请选择左侧会话查看详情和导出。
                    </p>
                )}

                <PromptDialog
                    open={renameDialogOpen}
                    title="重命名历史会话"
                    description="为这次采样记录设置一个更容易识别的名称，不会修改真实应用包名。"
                    initialValue={sessionDetail?.displayName ?? ""}
                    fieldLabel="会话名称"
                    placeholder="请输入历史会话名称"
                    confirmText={busyAction === "rename" ? "保存中..." : "保存"}
                    cancelText="取消"
                    errorText={renameDialogError}
                    busy={busyAction === "rename"}
                    onCancel={closeRenameDialog}
                    onConfirm={(value) => {
                        void handleRename(value);
                    }}
                />

                <ConfirmDialog
                    open={deleteDialogOpen}
                    title="删除历史会话"
                    description="删除后无法恢复。"
                    message={`确定删除历史会话“${sessionDetail?.displayName ?? ""}”吗？该操作会同时清理采样数据、截图和已导出的报告。`}
                    confirmText={
                        busyAction === "delete" ? "删除中..." : "确认删除"
                    }
                    cancelText="取消"
                    busy={busyAction === "delete"}
                    danger
                    onCancel={closeDeleteDialog}
                    onConfirm={() => {
                        void handleDelete();
                    }}
                />
            </div>
        </section>
    );
}
