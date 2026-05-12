import type { SessionSummary } from "@shared/types";
import { SessionPersistenceBadge } from "@renderer/components/SessionPersistenceBadge";
import { formatDateTime } from "@renderer/utils/formatters";
import styles from "@renderer/styles/ReportsPage.module.css";

interface ReportsSessionListProps {
    sessions: SessionSummary[];
    selectedSessionId: string;
    controlsDisabled: boolean;
    refreshing: boolean;
    onRefresh: () => void;
    onSelectSession: (sessionId: string) => void;
}

export function ReportsSessionList({
    sessions,
    selectedSessionId,
    controlsDisabled,
    refreshing,
    onRefresh,
    onSelectSession
}: ReportsSessionListProps) {
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
                            onClick={() => onSelectSession(session.id)}
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
