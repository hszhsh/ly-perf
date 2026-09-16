import type { SessionSummary } from "@shared/types";
import { SessionPersistenceBadge } from "@renderer/components/SessionPersistenceBadge";
import { formatDateTime } from "@renderer/utils/formatters";
import styles from "@renderer/styles/ReportsPage.module.css";

interface ReportsSessionListProps {
    sessions: SessionSummary[];
    selectedSessionId: string;
    selectedSessionIds: ReadonlySet<string>;
    controlsDisabled: boolean;
    refreshing: boolean;
    onRefresh: () => void;
    onSelectSession: (
        sessionId: string,
        mode: "replace" | "toggle" | "range"
    ) => void;
    onToggleAllSessionSelection: () => void;
    onBatchDelete: () => void;
}

export function ReportsSessionList({
    sessions,
    selectedSessionId,
    selectedSessionIds,
    controlsDisabled,
    refreshing,
    onRefresh,
    onSelectSession,
    onToggleAllSessionSelection,
    onBatchDelete
}: ReportsSessionListProps) {
    const allSelected =
        sessions.length > 0 &&
        sessions.every((session) => selectedSessionIds.has(session.id));

    return (
        <aside className={styles.sidebar}>
            <div className={styles.headerRow}>
                <h3>历史会话</h3>
                <button
                    type="button"
                    disabled={controlsDisabled}
                    onClick={onRefresh}
                >
                    {refreshing ? "刷新中..." : "刷新"}
                </button>
            </div>

            <div className={styles.batchActions}>
                <button
                    type="button"
                    disabled={controlsDisabled || sessions.length === 0}
                    onClick={onToggleAllSessionSelection}
                >
                    {allSelected ? "取消全选" : "全选"}
                </button>
                <span>已选 {selectedSessionIds.size} 项</span>
                <button
                    type="button"
                    className={styles.batchDeleteButton}
                    disabled={controlsDisabled || selectedSessionIds.size === 0}
                    onClick={onBatchDelete}
                >
                    批量删除
                </button>
            </div>

            <ul className={styles.sessionList}>
                {sessions.length === 0 ? (
                    <li className={styles.empty}>暂无历史会话</li>
                ) : null}

                {sessions.map((session) => (
                    <li
                        key={session.id}
                        className={
                            selectedSessionIds.has(session.id)
                                ? styles.sessionListItemSelected
                                : styles.sessionListItem
                        }
                    >
                        <button
                            type="button"
                            disabled={controlsDisabled}
                            aria-pressed={selectedSessionIds.has(session.id)}
                            className={
                                selectedSessionId === session.id &&
                                selectedSessionIds.has(session.id)
                                    ? `${styles.sessionActive} ${styles.sessionBatchSelected}`
                                    : selectedSessionId === session.id
                                      ? styles.sessionActive
                                      : selectedSessionIds.has(session.id)
                                        ? `${styles.sessionBtn} ${styles.sessionBatchSelected}`
                                        : styles.sessionBtn
                            }
                            onClick={(event) => {
                                const mode = event.shiftKey
                                    ? "range"
                                    : event.ctrlKey
                                      ? "toggle"
                                      : "replace";
                                onSelectSession(session.id, mode);
                            }}
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
                                  开始: {formatDateTime(session.startedAt)}
                            </div>
                            <div className={styles.sessionMeta}>
                                样本: {session.sampleCount}
                            </div>
                        </button>
                    </li>
                ))}
            </ul>
        </aside>
    );
}
