import { useEffect, useState } from "react";
import type {
    ExportResult,
    SessionDetail,
    SessionSummary
} from "@shared/types";

export type BusyAction = "delete" | "export-html" | "export-xlsx" | "rename";

export interface FeedbackState {
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
    sessionDetail: SessionDetail | null;
    exportResult: ExportResult | null;
    feedback: FeedbackState | null;
    busyAction: BusyAction | null;
    refreshing: boolean;
    renameDialogOpen: boolean;
    renameDialogError: string | null;
    deleteDialogOpen: boolean;
    reloadSessions: () => Promise<void>;
    setSelectedSessionId: React.Dispatch<React.SetStateAction<string>>;
    handleExport: (format: "html" | "xlsx") => Promise<void>;
    openRenameDialog: () => void;
    closeRenameDialog: () => void;
    handleRename: (nextName: string) => Promise<void>;
    openDeleteDialog: () => void;
    closeDeleteDialog: () => void;
    handleDelete: () => Promise<void>;
}

export function useReportsRuntime(): UseReportsRuntimeResult {
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

    return {
        sessions,
        selectedSessionId,
        sessionDetail,
        exportResult,
        feedback,
        busyAction,
        refreshing,
        renameDialogOpen,
        renameDialogError,
        deleteDialogOpen,
        reloadSessions,
        setSelectedSessionId,
        handleExport,
        openRenameDialog,
        closeRenameDialog,
        handleRename,
        openDeleteDialog,
        closeDeleteDialog,
        handleDelete
    };
}
