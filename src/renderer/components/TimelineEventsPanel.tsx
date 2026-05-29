import { useEffect, useMemo, useState } from "react";
import type {
    MonitorSample,
    SessionTimelineEvent,
    SessionTimelineEventType,
    SessionTimelineEventInput,
    SessionTimelineEventUpdate
} from "@shared/types";
import { ConfirmDialog } from "@renderer/components/ConfirmDialog";
import { ModalDialog } from "@renderer/components/ModalDialog";
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
    canCreate: boolean;
    canModify: boolean;
    busyAction: "capture" | "create" | "update" | "delete" | null;
    errorText?: string | null;
    requestedCreateTimestamp?: number | null;
    onCreateRequestHandled?: () => void;
    onClearError?: () => void;
    onCaptureScreenshot?: () => Promise<boolean>;
    onCreate?: (input: SessionTimelineEventInput) => Promise<boolean>;
    onUpdate: (input: SessionTimelineEventUpdate) => Promise<boolean>;
    onDelete: (eventId: string) => Promise<boolean>;
    onLocateTimestamp?: (timestamp: number) => void;
}

interface ScreenshotPreviewState {
    event: SessionTimelineEvent;
    imageUrl: string;
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

function getEventDisplayText(event: SessionTimelineEvent): string {
    const normalizedText = event.text.trim();

    if (normalizedText) {
        return normalizedText;
    }

    return event.type === "screenshot" ? "截图" : "";
}

function ScreenshotThumbnail({
    event,
    onOpenPreview
}: {
    event: SessionTimelineEvent;
    onOpenPreview: (event: SessionTimelineEvent, imageUrl: string) => void;
}) {
    const [imageUrl, setImageUrl] = useState("");
    const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
        "loading"
    );

    useEffect(() => {
        let disposed = false;
        const screenshotPath = event.screenshotPath;

        if (!screenshotPath) {
            setImageUrl("");
            setLoadState("error");
            return () => {
                disposed = true;
            };
        }

        setLoadState("loading");

        void (async () => {
            try {
                const dataUrl = await window.lyPerf.readScreenshotDataUrl(
                    screenshotPath
                );

                if (disposed) {
                    return;
                }

                if (dataUrl) {
                    setImageUrl(dataUrl);
                    setLoadState("ready");
                    return;
                }

                setImageUrl("");
                setLoadState("error");
            } catch {
                if (!disposed) {
                    setImageUrl("");
                    setLoadState("error");
                }
            }
        })();

        return () => {
            disposed = true;
        };
    }, [event.screenshotPath]);

    return (
        <div className={styles.screenshotBlock}>
            <button
                type="button"
                className={styles.thumbnailButton}
                disabled={loadState !== "ready"}
                onClick={() => {
                    if (loadState === "ready") {
                        onOpenPreview(event, imageUrl);
                    }
                }}
            >
                {loadState === "ready" ? (
                    <img
                        className={styles.thumbnailImage}
                        src={imageUrl}
                        alt={`timeline screenshot at ${formatEventTimestamp(event.timestamp)}`}
                    />
                ) : (
                    <span className={styles.thumbnailPlaceholder}>
                        {loadState === "loading" ? "截图加载中..." : "截图不可用"}
                    </span>
                )}
            </button>
            <span className={styles.screenshotHint}>
                {loadState === "ready" ? "点击查看大图" : "截图文件不可用"}
            </span>
        </div>
    );
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
    canCreate,
    canModify,
    busyAction,
    errorText,
    requestedCreateTimestamp,
    onCreateRequestHandled,
    onClearError,
    onCaptureScreenshot,
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
    const [previewState, setPreviewState] = useState<ScreenshotPreviewState | null>(
        null
    );
    const minTimestamp = samples[0]?.timestamp ?? null;
    const maxTimestamp = samples[samples.length - 1]?.timestamp ?? null;
    const showCreateControls = canCreate || !canModify;
    const readOnlyMessage = !canCreate && canModify
        ? "历史报告只支持编辑或删除已有事件，新增事件请在实时监控中完成。"
        : !canCreate && !canModify
          ? "当前会话未处于可编辑状态。开始实时监控后才能新增或修改时间轴事件。"
          : null;
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

            const displayText = getEventDisplayText(event).toLocaleLowerCase();
            const typeLabel = getTimelineEventTypeLabel(event.type).toLocaleLowerCase();
            const timestampText = formatEventTimestamp(event.timestamp).toLocaleLowerCase();

            return (
                displayText.includes(normalizedSearch) ||
                typeLabel.includes(normalizedSearch) ||
                timestampText.includes(normalizedSearch)
            );
        });
    }, [events, searchText, typeFilter]);

    useEffect(() => {
        if (
            requestedCreateTimestamp === null ||
            requestedCreateTimestamp === undefined ||
            !canCreate
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
        canCreate,
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

    useEffect(() => {
        if (
            previewState &&
            !events.some((event) => event.id === previewState.event.id)
        ) {
            setPreviewState(null);
        }
    }, [events, previewState]);

    async function handleDialogConfirm(
        input: SessionTimelineEventInput
    ): Promise<void> {
        if (!dialogState) {
            return;
        }

        const success =
            dialogState.mode === "create"
                ? (await onCreate?.(input)) ?? false
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

                {showCreateControls ? (
                    <div className={styles.headerActions}>
                        <button
                            type="button"
                            disabled={!canCreate || busyAction !== null}
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

                        {onCaptureScreenshot ? (
                            <button
                                type="button"
                                disabled={!canCreate || busyAction !== null}
                                onClick={() => {
                                    onClearError?.();
                                    void onCaptureScreenshot();
                                }}
                            >
                                {busyAction === "capture"
                                    ? "截图中..."
                                    : "截图并添加事件"}
                            </button>
                        ) : null}
                    </div>
                ) : null}
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

            {readOnlyMessage ? <p className={styles.empty}>{readOnlyMessage}</p> : null}

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
                                        disabled={!canModify || busyAction !== null}
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
                                        disabled={!canModify || busyAction !== null}
                                        onClick={() => setDeleteTarget(event)}
                                    >
                                        删除
                                    </button>
                                </div>
                            </div>

                            <div className={styles.itemBody}>
                                <p className={styles.itemText}>
                                    {getEventDisplayText(event)}
                                </p>

                                {event.screenshotPath ? (
                                    <ScreenshotThumbnail
                                        event={event}
                                        onOpenPreview={(previewEvent, imageUrl) => {
                                            setPreviewState({
                                                event: previewEvent,
                                                imageUrl
                                            });
                                        }}
                                    />
                                ) : null}
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className={styles.empty}>
                    {canCreate
                        ? "还没有时间轴事件。可以直接点击图表中的某个时间点，或者使用顶部按钮添加。"
                        : "还没有时间轴事件。历史报告中不可新增，请在实时监控时记录。"}
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
                        ? `确定删除 ${formatEventTimestamp(deleteTarget.timestamp)} 的${getTimelineEventTypeLabel(deleteTarget.type)}事件“${getEventDisplayText(deleteTarget)}”吗？`
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

            <ModalDialog
                open={previewState !== null}
                title="截图预览"
                description={
                    previewState
                        ? `${formatEventTimestamp(previewState.event.timestamp)} · ${getTimelineEventTypeLabel(previewState.event.type)}`
                        : undefined
                }
                dialogClassName={styles.previewDialog}
                bodyClassName={styles.previewBody}
                onClose={() => setPreviewState(null)}
                footer={
                    <button
                        type="button"
                        onClick={() => setPreviewState(null)}
                    >
                        关闭
                    </button>
                }
            >
                {previewState?.imageUrl ? (
                    <div className={styles.previewContent}>
                        <img
                            className={styles.previewImage}
                            src={previewState.imageUrl}
                            alt={`timeline screenshot at ${formatEventTimestamp(previewState.event.timestamp)}`}
                        />
                        {previewState.event.text.trim() ? (
                            <p className={styles.previewCaption}>
                                备注：{previewState.event.text.trim()}
                            </p>
                        ) : null}
                    </div>
                ) : (
                    <p className={styles.empty}>
                        截图加载失败，文件可能已不存在或不可访问。
                    </p>
                )}
            </ModalDialog>
        </section>
    );
}