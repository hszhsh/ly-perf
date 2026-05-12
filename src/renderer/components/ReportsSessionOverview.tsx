import type { ExportResult, SessionDetail } from "@shared/types";
import { SessionPersistenceBadge } from "@renderer/components/SessionPersistenceBadge";
import {
    formatDateTime,
    formatTrafficMegabytes
} from "@renderer/utils/formatters";
import styles from "@renderer/styles/ReportsPage.module.css";

interface ReportsSessionOverviewProps {
    sessionDetail: SessionDetail;
    exportResult: ExportResult | null;
    controlsDisabled: boolean;
    latestTotalTrafficMb: number | null | undefined;
    onRename: () => void;
    onDelete: () => void;
    onExportHtml: () => void;
    onExportXlsx: () => void;
}

function getPersistenceDescription(session: SessionDetail): string {
    if (session.persistenceState === "recovered") {
        return "该会话由 append-only journal 恢复，可能缺少异常退出前最后一小段未完成写盘的数据。";
    }

    return "该会话已完成正常落盘，可直接查看、导出和管理。";
}

export function ReportsSessionOverview({
    sessionDetail,
    exportResult,
    controlsDisabled,
    latestTotalTrafficMb,
    onRename,
    onDelete,
    onExportHtml,
    onExportXlsx
}: ReportsSessionOverviewProps) {
    return (
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
                        {sessionDetail.deviceInfo.model} ({sessionDetail.serial}
                        )
                    </p>
                </div>
                <div className={styles.detailActions}>
                    <div className={styles.exportButtons}>
                        <button
                            type="button"
                            disabled={controlsDisabled}
                            onClick={onRename}
                        >
                            重命名
                        </button>
                        <button
                            type="button"
                            className={styles.dangerButton}
                            disabled={controlsDisabled}
                            onClick={onDelete}
                        >
                            删除
                        </button>
                    </div>
                    <div className={styles.exportButtons}>
                        <button
                            type="button"
                            disabled={controlsDisabled}
                            onClick={onExportHtml}
                        >
                            导出 HTML
                        </button>
                        <button
                            type="button"
                            disabled={controlsDisabled}
                            onClick={onExportXlsx}
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
                    <span>{getPersistenceDescription(sessionDetail)}</span>
                </div>
            ) : null}

            <div className={styles.summaryGrid}>
                <div>
                    <span>会话状态</span>
                    <strong>
                        {sessionDetail.persistenceState === "recovered"
                            ? "Journal 恢复"
                            : "已完成落盘"}
                    </strong>
                </div>
                <div>
                    <span>开始时间</span>
                    <strong>{formatDateTime(sessionDetail.startedAt)}</strong>
                </div>
                <div>
                    <span>结束时间</span>
                    <strong>{formatDateTime(sessionDetail.endedAt)}</strong>
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
                        {sessionDetail.config.cpuMode === "normalized"
                            ? "CPU Usage (Normalized)"
                            : "CPU Usage（传统）"}
                    </strong>
                </div>
                <div>
                    <span>总流量</span>
                    <strong>
                        {formatTrafficMegabytes(latestTotalTrafficMb)}
                    </strong>
                </div>
            </div>
        </>
    );
}
