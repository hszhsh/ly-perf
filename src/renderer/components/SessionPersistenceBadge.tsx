import type { SessionPersistenceState } from "@shared/types";
import styles from "./SessionPersistenceBadge.module.css";

interface SessionPersistenceBadgeProps {
    state: SessionPersistenceState;
    compact?: boolean;
}

export function SessionPersistenceBadge({
    state,
    compact = false
}: SessionPersistenceBadgeProps) {
    const stateClass =
        state === "recovered" ? styles.recovered : styles.finalized;
    const label = state === "recovered" ? "Journal 恢复" : "已完成";

    return (
        <span
            className={`${styles.badge} ${stateClass} ${compact ? styles.compact : ""}`.trim()}
        >
            {label}
        </span>
    );
}
