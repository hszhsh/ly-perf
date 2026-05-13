import { useEffect, useMemo, useState } from "react";
import type {
    MonitorSample,
    SessionTimelineEvent,
    SessionTimelineEventType,
    SessionTimelineEventInput,
    SessionTimelineEventUpdate
} from "@shared/types";
import { ConfirmDialog } from "@renderer/components/ConfirmDialog";
import { TimelineEventDialog } from "@renderer/components/TimelineEventDialog";
import {
    TIMELINE_EVENT_TYPE_PRESETS,
    createDefaultTimelineEventInput,
    getTimelineEventTypeLabel
} from "@renderer/components/timelineEventPresets";
import styles from "@renderer/components/TimelineEventsPanel.module.css";

interface TimelineEventsPanelProps {
    events: SessionTimelineEvent[];
    samples: MonitorSample[];
    editable: boolean;
    busyAction: "create" | "update" | "delete" | null;
    errorText?: string | null;
    requestedCreateTimestamp?: number | null;
    onCreateRequestHandled?: () => void;
    onClearError?: () => void;
    onCreate: (input: SessionTimelineEventInput) => Promise<boolean>;
    onUpdate: (input: SessionTimelineEventUpdate) => Promise<boolean>;
    onDelete: (eventId: string) => Promise<boolean>;
    onLocateTimestamp?: (timestamp: number) => void;
}

function formatEventTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString(undefined, {
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

function clampTimestamp(
    timestamp: number,
    minTimestamp: number | null,
    maxTimestamp: number | null
): number {
    if (minTimestamp !== null && timestamp < minTimestamp) {
        return minTimestamp;
    }

    if (maxTimestamp !== null && timestamp > maxTimestamp) {
        return maxTimestamp;
    }

    return timestamp;
}

type DialogState =
    | {
          mode: "create";
          initialValue: SessionTimelineEventInput;
      }
    | {
          mode: "edit";
          initialValue: SessionTimelineEvent;
      }
    | null;

export function TimelineEventsPanel({
    events,
    samples,
    editable,
    busyAction,
    errorText,
    requestedCreateTimestamp,
    onCreateRequestHandled,
    onClearError,
    onCreate,
    onUpdate,
    onDelete,
    onLocateTimestamp
}: TimelineEventsPanelProps) {
    const [dialogState, setDialogState] = useState<DialogState>(null);
    const [deleteTarget, setDeleteTarget] = useState<SessionTimelineEvent | null>(
        null
    );
    const [typeFilter, setTypeFilter] = useState<
        SessionTimelineEventType | "all"
    >("all");
    const [searchText, setSearchText] = useState("");
    const [locatedEventId, setLocatedEventId] = useState<string | null>(null);
    const minTimestamp = samples[0]?.timestamp ?? null;
    const maxTimestamp = samples[samples.length - 1]?.timestamp ?? null;
    const defaultCreateTimestamp = useMemo(() => {
        if (maxTimestamp !== null) {
            return maxTimestamp;
        }

        if (minTimestamp !== null) {
            return minTimestamp;
        }

        return Date.now();
    }, [maxTimestamp, minTimestamp]);
    const filteredEvents = useMemo(() => {
        const normalizedSearch = searchText.trim().toLocaleLowerCase();

        return events.filter((event) => {
            if (typeFilter !== "all" && event.type !== typeFilter) {
                return false;
            }

            if (!normalizedSearch) {
                return true;
            }

            const typeLabel = getTimelineEventTypeLabel(event.type).toLocaleLowerCase();
            const timestampText = formatEventTimestamp(event.timestamp).toLocaleLowerCase();

            return (
                event.text.toLocaleLowerCase().includes(normalizedSearch) ||
                typeLabel.includes(normalizedSearch) ||
                timestampText.includes(normalizedSearch)
            );
        });
    }, [events, searchText, typeFilter]);

    useEffect(() => {
        if (
            requestedCreateTimestamp === null ||
            requestedCreateTimestamp === undefined ||
            !editable
        ) {
            return;
        }

        onClearError?.();
        setDialogState({
            mode: "create",
            initialValue: createDefaultTimelineEventInput(
                clampTimestamp(
                    requestedCreateTimestamp,
                    minTimestamp,
                    maxTimestamp
                )
            )
        });
        onCreateRequestHandled?.();
    }, [
        editable,
        maxTimestamp,
        minTimestamp,
        onClearError,
        onCreateRequestHandled,
        requestedCreateTimestamp
    ]);

    useEffect(() => {
        if (
            locatedEventId &&
            !events.some((event) => event.id === locatedEventId)
        ) {
            setLocatedEventId(null);
        }
    }, [events, locatedEventId]);

    async function handleDialogConfirm(
        input: SessionTimelineEventInput
    ): Promise<void> {
        if (!dialogState) {
            return;
        }

        const success =
            dialogState.mode === "create"
                ? await onCreate(input)
                : await onUpdate({
                      id: dialogState.initialValue.id,
                      ...input
                  });

        if (success) {
            setDialogState(null);
        }
    }

    async function handleDeleteConfirm(): Promise<void> {
        if (!deleteTarget) {
            return;
        }

        const success = await onDelete(deleteTarget.id);
        if (success) {
            setDeleteTarget(null);
        }
    }

    return (
        <section className={styles.section}>
            <div className={styles.header}>
                <div className={styles.headerTitle}>
                    <strong>时间轴事件</strong>
                    <span>
                        共 {events.length} 条事件。点击图表时间点或手动选择时间，都可以把事件同步显示到全部图表上。
                    </span>
                </div>

                <div className={styles.headerActions}>
                    <button
                        type="button"
                        disabled={!editable || busyAction !== null}
                        onClick={() => {
                            onClearError?.();
                            setDialogState({
                                mode: "create",
                                initialValue: createDefaultTimelineEventInput(
                                    defaultCreateTimestamp
                                )
                            });
                        }}
                    >
                        手动添加事件
                    </button>
                </div>
            </div>

            {events.length > 0 ? (
                <div className={styles.filterBar}>
                    <label className={styles.inlineField}>
                        <span>类型筛选</span>
                        <select
                            className={styles.selectInput}
                            value={typeFilter}
                            onChange={(event) =>
                                setTypeFilter(
                                    event.target.value as SessionTimelineEventType | "all"
                                )
                            }
                        >
                            <option value="all">全部类型</option>
                            {TIMELINE_EVENT_TYPE_PRESETS.map((preset) => (
                                <option key={preset.type} value={preset.type}>
                                    {preset.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className={`${styles.inlineField} ${styles.searchField}`}>
                        <span>搜索</span>
                        <input
                            className={styles.textInput}
                            value={searchText}
                            placeholder="按事件内容、类型或时间筛选"
                            onChange={(event) => setSearchText(event.target.value)}
                        />
                    </label>

                    <div className={styles.filterActions}>
                        <span className={styles.listStatus}>
                            显示 {filteredEvents.length} / {events.length}
                        </span>
                        {(searchText || typeFilter !== "all") && (
                            <button
                                type="button"
                                onClick={() => {
                                    setSearchText("");
                                    setTypeFilter("all");
                                }}
                            >
                                清空筛选
                            </button>
                        )}
                    </div>
                </div>
            ) : null}

            {!editable ? (
                <p className={styles.empty}>
                    当前会话未处于可编辑状态。历史报告页仍可继续维护事件。
                </p>
            ) : null}

            {errorText ? <p className={styles.error}>{errorText}</p> : null}

            {events.length > 0 ? (
                <ul className={styles.list}>
                    {filteredEvents.map((event) => (
                        <li
                            key={event.id}
                            className={`${styles.item} ${
                                locatedEventId === event.id ? styles.itemActive : ""
                            }`}
                        >
                            <div className={styles.itemHeader}>
                                <div className={styles.itemTitle}>
                                    <span
                                        className={styles.colorDot}
                                        style={{ backgroundColor: event.color }}
                                    />
                                    <span className={styles.typeBadge}>
                                        {getTimelineEventTypeLabel(event.type)}
                                    </span>
                                    <span className={styles.timestamp}>
                                        {formatEventTimestamp(event.timestamp)}
                                    </span>
                                </div>

                                <div className={styles.itemActions}>
                                    {onLocateTimestamp ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setLocatedEventId(event.id);
                                                onLocateTimestamp(event.timestamp);
                                            }}
                                        >
                                            定位到事件
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        disabled={!editable || busyAction !== null}
                                        onClick={() => {
                                            onClearError?.();
                                            setDialogState({
                                                mode: "edit",
                                                initialValue: event
                                            });
                                        }}
                                    >
                                        编辑
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!editable || busyAction !== null}
                                        onClick={() => setDeleteTarget(event)}
                                    >
                                        删除
                                    </button>
                                </div>
                            </div>

                            <p className={styles.itemText}>{event.text}</p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className={styles.empty}>
                    还没有时间轴事件。可以直接点击图表中的某个时间点，或者手动选择时间后添加。
                </p>
            )}

            {events.length > 0 && filteredEvents.length === 0 ? (
                <p className={styles.empty}>
                    当前筛选条件下没有匹配的时间轴事件。
                </p>
            ) : null}

            <TimelineEventDialog
                open={dialogState !== null}
                mode={dialogState?.mode ?? "create"}
                initialValue={dialogState?.initialValue ?? null}
                busy={busyAction === "create" || busyAction === "update"}
                errorText={errorText}
                minTimestamp={minTimestamp}
                maxTimestamp={maxTimestamp}
                onCancel={() => {
                    if (busyAction !== null) {
                        return;
                    }

                    setDialogState(null);
                }}
                onConfirm={(input) => {
                    void handleDialogConfirm(input);
                }}
            />

            <ConfirmDialog
                open={deleteTarget !== null}
                title="删除时间轴事件"
                description="删除后将同时从当前会话的全部图表上移除。"
                message={
                    deleteTarget
                        ? `确定删除 ${formatEventTimestamp(deleteTarget.timestamp)} 的事件“${deleteTarget.text}”吗？`
                        : ""
                }
                confirmText={busyAction === "delete" ? "删除中..." : "确认删除"}
                cancelText="取消"
                busy={busyAction === "delete"}
                danger
                onCancel={() => {
                    if (busyAction === "delete") {
                        return;
                    }

                    setDeleteTarget(null);
                }}
                onConfirm={() => {
                    void handleDeleteConfirm();
                }}
            />
        </section>
    );
}