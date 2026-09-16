import { useEffect, useRef, useState } from "react";
import type {
    ExportResult,
    SessionDetail,
    SessionTimelineEventInput,
    SessionTimelineEventUpdate,
    SessionSummary
} from "@shared/types";

export type BusyAction =
    | "delete"
    | "batch-delete"
    | "export-html"
    | "export-xlsx"
    | "export-csv"
    | "rename";
export type EventBusyAction = "create" | "update" | "delete";
export type SessionSelectionMode = "replace" | "toggle" | "range";

export interface FeedbackState {
    id: number;
    type: "error" | "success";
    text: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallback;
}

interface UseReportsRuntimeResult {
    sessions: SessionSummary[];
    selectedSessionId: string;
    selectedSessionIds: ReadonlySet<string>;
    sessionDetail: SessionDetail | null;
    exportResult: ExportResult | null;
    feedback: FeedbackState | null;
    busyAction: BusyAction | null;
    eventBusyAction: EventBusyAction | null;
    eventErrorMessage: string | null;
    clearFeedback: () => void;
    clearEventError: () => void;
    refreshing: boolean;
    renameDialogOpen: boolean;
    renameDialogError: string | null;
    deleteDialogOpen: boolean;
    batchDeleteDialogOpen: boolean;
    reloadSessions: () => Promise<void>;
    selectSession: (
        sessionId: string,
        mode: SessionSelectionMode
    ) => void;
    handleExport: (format: "html" | "xlsx" | "csv") => Promise<void>;
    openRenameDialog: () => void;
    closeRenameDialog: () => void;
    handleRename: (nextName: string) => Promise<void>;
    openDeleteDialog: () => void;
    closeDeleteDialog: () => void;
    handleDelete: () => Promise<void>;
    toggleAllSessionSelection: () => void;
    openBatchDeleteDialog: () => void;
    closeBatchDeleteDialog: () => void;
    handleBatchDelete: () => Promise<void>;
    handleCreateEvent: (input: SessionTimelineEventInput) => Promise<boolean>;
    handleUpdateEvent: (input: SessionTimelineEventUpdate) => Promise<boolean>;
    handleDeleteEvent: (eventId: string) => Promise<boolean>;
}

export function useReportsRuntime(): UseReportsRuntimeResult {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState("");
    const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
        () => new Set()
    );
    const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(
        null
    );
    const [exportResult, setExportResult] = useState<ExportResult | null>(null);
    const [feedback, setFeedback] = useState<FeedbackState | null>(null);
    const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
    const [eventBusyAction, setEventBusyAction] =
        useState<EventBusyAction | null>(null);
    const [eventErrorMessage, setEventErrorMessage] = useState<string | null>(
        null
    );
    const [refreshing, setRefreshing] = useState(false);
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [renameDialogError, setRenameDialogError] = useState<string | null>(
        null
    );
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
    const selectionAnchorIdRef = useRef<string | null>(null);
    const feedbackIdRef = useRef(0);

    function showFeedback(type: FeedbackState["type"], text: string): void {
        feedbackIdRef.current += 1;
        setFeedback({
            id: feedbackIdRef.current,
            type,
            text
        });
    }

    async function reloadSessions(): Promise<void> {
        setRefreshing(true);

        try {
            const list = await window.lyPerf.listSessions();
            setSessions(list);
            const availableIds = new Set(list.map((session) => session.id));
            const shouldSelectDefault =
                !selectedSessionId || !availableIds.has(selectedSessionId);
            const nextSelectedSessionId =
                selectedSessionId && availableIds.has(selectedSessionId)
                    ? selectedSessionId
                    : list[0]?.id ?? "";
            if (
                selectionAnchorIdRef.current &&
                !availableIds.has(selectionAnchorIdRef.current)
            ) {
                selectionAnchorIdRef.current = null;
            }
            setSelectedSessionIds((current) => {
                const next = new Set(
                    Array.from(current).filter((sessionId) =>
                        availableIds.has(sessionId)
                    )
                );
                if (next.size === 0 && shouldSelectDefault && nextSelectedSessionId) {
                    next.add(nextSelectedSessionId);
                }
                return next;
            });

            setSelectedSessionId((current) => {
                if (current && list.some((item) => item.id === current)) {
                    return current;
                }

                return nextSelectedSessionId;
            });
        } catch (error) {
            showFeedback("error", getErrorMessage(error, "加载历史会话失败。"));
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
            setEventErrorMessage(null);
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
                setEventErrorMessage(null);
            } catch (error) {
                if (cancelled) {
                    return;
                }

                setSessionDetail(null);
                setExportResult(null);
                showFeedback(
                    "error",
                    getErrorMessage(error, "加载历史会话详情失败。")
                );
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [selectedSessionId]);

    async function handleExport(
        format: "html" | "xlsx" | "csv"
    ): Promise<void> {
        if (!selectedSessionId) {
            return;
        }

        setBusyAction(`export-${format}`);

        try {
            const result = await window.lyPerf.exportSession(
                selectedSessionId,
                format
            );
            setExportResult(result);

            try {
                await window.lyPerf.openExportDirectory(result.outputPath);
                setFeedback(null);
            } catch (error) {
                showFeedback(
                    "error",
                    getErrorMessage(
                        error,
                        "报告已导出，但打开导出目录失败。"
                    )
                );
            }
        } catch (error) {
            showFeedback("error", getErrorMessage(error, "导出历史会话失败。"));
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
            showFeedback("success", `已将历史会话重命名为 ${renamed.displayName}。`);
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
            setSelectedSessionIds((current) => {
                const next = new Set(current);
                next.delete(sessionDetail.id);
                return next;
            });
            setSessionDetail(null);
            setExportResult(null);
            showFeedback("success", `已删除历史会话 ${sessionDetail.displayName}。`);
            setEventErrorMessage(null);
            await reloadSessions();
        } catch (error) {
            showFeedback("error", getErrorMessage(error, "删除历史会话失败。"));
        } finally {
            setBusyAction(null);
        }
    }

    function selectSession(
        sessionId: string,
        mode: SessionSelectionMode
    ): void {
        const sessionIndex = sessions.findIndex(
            (session) => session.id === sessionId
        );
        if (sessionIndex < 0) {
            return;
        }

        if (mode === "replace") {
            setSelectedSessionIds(new Set([sessionId]));
            selectionAnchorIdRef.current = sessionId;
        } else if (mode === "toggle") {
            setSelectedSessionIds((current) => {
                const next = new Set(current);
                if (next.has(sessionId)) {
                    next.delete(sessionId);
                } else {
                    next.add(sessionId);
                }
                return next;
            });
            selectionAnchorIdRef.current = sessionId;
        } else {
            const anchorId =
                selectionAnchorIdRef.current &&
                sessions.some(
                    (session) => session.id === selectionAnchorIdRef.current
                )
                    ? selectionAnchorIdRef.current
                    : sessions.some((session) => session.id === selectedSessionId)
                      ? selectedSessionId
                      : sessionId;
            const anchorIndex = sessions.findIndex(
                (session) => session.id === anchorId
            );
            const start = Math.min(anchorIndex, sessionIndex);
            const end = Math.max(anchorIndex, sessionIndex);
            setSelectedSessionIds(
                new Set(
                    sessions
                        .slice(start, end + 1)
                        .map((session) => session.id)
                )
            );
        }

        setSelectedSessionId(sessionId);
    }

    function toggleAllSessionSelection(): void {
        setSelectedSessionIds((current) => {
            const allSelected =
                sessions.length > 0 &&
                sessions.every((session) => current.has(session.id));
            return allSelected
                ? new Set()
                : new Set(sessions.map((session) => session.id));
        });
    }

    function openBatchDeleteDialog(): void {
        if (selectedSessionIds.size === 0) {
            return;
        }

        setBatchDeleteDialogOpen(true);
    }

    function closeBatchDeleteDialog(): void {
        if (busyAction === "batch-delete") {
            return;
        }

        setBatchDeleteDialogOpen(false);
    }

    async function handleBatchDelete(): Promise<void> {
        const sessionIds = Array.from(selectedSessionIds);
        if (sessionIds.length === 0) {
            setBatchDeleteDialogOpen(false);
            return;
        }

        setBusyAction("batch-delete");

        try {
            const result = await window.lyPerf.deleteSessions(sessionIds);
            const deletedIds = new Set(result.deletedIds);
            setBatchDeleteDialogOpen(false);
            setSelectedSessionIds((current) => {
                const next = new Set(current);
                for (const sessionId of deletedIds) {
                    next.delete(sessionId);
                }
                return next;
            });

            if (deletedIds.has(selectedSessionId)) {
                setSelectedSessionId("");
                setSessionDetail(null);
                setExportResult(null);
                setEventErrorMessage(null);
            }

            await reloadSessions();

            if (result.failures.length > 0) {
                const firstFailure = result.failures[0];
                showFeedback(
                    "error",
                    `已删除 ${result.deletedIds.length} 项，${result.failures.length} 项失败。${firstFailure.message}`
                );
            } else {
                showFeedback(
                    "success",
                    `已删除 ${result.deletedIds.length} 个历史会话。`
                );
            }
        } catch (error) {
            showFeedback(
                "error",
                getErrorMessage(error, "批量删除历史会话失败。")
            );
        } finally {
            setBusyAction(null);
        }
    }

    function clearFeedback(): void {
        setFeedback(null);
    }

    function clearEventError(): void {
        setEventErrorMessage(null);
    }

    async function mutateSessionEvent(
        action: EventBusyAction,
        fallbackMessage: string,
        handler: (sessionId: string) => Promise<SessionDetail>
    ): Promise<boolean> {
        if (!sessionDetail) {
            return false;
        }

        setEventBusyAction(action);

        try {
            const updated = await handler(sessionDetail.id);
            setSessionDetail(updated);
            setEventErrorMessage(null);
            return true;
        } catch (error) {
            setEventErrorMessage(getErrorMessage(error, fallbackMessage));
            return false;
        } finally {
            setEventBusyAction(null);
        }
    }

    async function handleCreateEvent(
        input: SessionTimelineEventInput
    ): Promise<boolean> {
        return mutateSessionEvent("create", "新增时间轴事件失败。", (sessionId) =>
            window.lyPerf.createSessionEvent(sessionId, input)
        );
    }

    async function handleUpdateEvent(
        input: SessionTimelineEventUpdate
    ): Promise<boolean> {
        return mutateSessionEvent("update", "更新时间轴事件失败。", (sessionId) =>
            window.lyPerf.updateSessionEvent(sessionId, input)
        );
    }

    async function handleDeleteEvent(eventId: string): Promise<boolean> {
        return mutateSessionEvent("delete", "删除时间轴事件失败。", (sessionId) =>
            window.lyPerf.deleteSessionEvent(sessionId, eventId)
        );
    }

    return {
        sessions,
        selectedSessionId,
        selectedSessionIds,
        sessionDetail,
        exportResult,
        feedback,
        busyAction,
        eventBusyAction,
        eventErrorMessage,
        clearFeedback,
        clearEventError,
        refreshing,
        renameDialogOpen,
        renameDialogError,
        deleteDialogOpen,
        batchDeleteDialogOpen,
        reloadSessions,
        selectSession,
        handleExport,
        openRenameDialog,
        closeRenameDialog,
        handleRename,
        openDeleteDialog,
        closeDeleteDialog,
        handleDelete,
        toggleAllSessionSelection,
        openBatchDeleteDialog,
        closeBatchDeleteDialog,
        handleBatchDelete,
        handleCreateEvent,
        handleUpdateEvent,
        handleDeleteEvent
    };
}
