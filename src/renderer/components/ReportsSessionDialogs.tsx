import { ConfirmDialog } from "@renderer/components/ConfirmDialog";
import { PromptDialog } from "@renderer/components/PromptDialog";

interface ReportsSessionDialogsProps {
    sessionDisplayName: string;
    renameDialogOpen: boolean;
    renameDialogError: string | null;
    deleteDialogOpen: boolean;
    batchDeleteDialogOpen: boolean;
    batchDeleteCount: number;
    busyAction:
        | "delete"
        | "batch-delete"
        | "export-html"
        | "export-xlsx"
        | "export-csv"
        | "rename"
        | null;
    onCancelRename: () => void;
    onConfirmRename: (value: string) => void;
    onCancelDelete: () => void;
    onConfirmDelete: () => void;
    onCancelBatchDelete: () => void;
    onConfirmBatchDelete: () => void;
}

export function ReportsSessionDialogs({
    sessionDisplayName,
    renameDialogOpen,
    renameDialogError,
    deleteDialogOpen,
    batchDeleteDialogOpen,
    batchDeleteCount,
    busyAction,
    onCancelRename,
    onConfirmRename,
    onCancelDelete,
    onConfirmDelete,
    onCancelBatchDelete,
    onConfirmBatchDelete
}: ReportsSessionDialogsProps) {
    return (
        <>
            <PromptDialog
                open={renameDialogOpen}
                title="重命名历史会话"
                description="为这次采样记录设置一个更容易识别的名称，不会修改真实应用包名。"
                initialValue={sessionDisplayName}
                fieldLabel="会话名称"
                placeholder="请输入历史会话名称"
                confirmText={busyAction === "rename" ? "保存中..." : "保存"}
                cancelText="取消"
                errorText={renameDialogError}
                busy={busyAction === "rename"}
                onCancel={onCancelRename}
                onConfirm={onConfirmRename}
            />

            <ConfirmDialog
                open={deleteDialogOpen}
                title="删除历史会话"
                description="删除后无法恢复。"
                message={`确定删除历史会话“${sessionDisplayName}”吗？该操作会同时清理采样数据、截图和已导出的报告。`}
                confirmText={busyAction === "delete" ? "删除中..." : "确认删除"}
                cancelText="取消"
                busy={busyAction === "delete"}
                danger
                onCancel={onCancelDelete}
                onConfirm={onConfirmDelete}
            />

            <ConfirmDialog
                open={batchDeleteDialogOpen}
                title="批量删除历史会话"
                description="删除后无法恢复。"
                message={`确定删除选中的 ${batchDeleteCount} 个历史会话吗？该操作会同时清理对应的采样数据、截图和已导出的报告。`}
                confirmText={
                    busyAction === "batch-delete"
                        ? "批量删除中..."
                        : `确认删除 ${batchDeleteCount} 项`
                }
                cancelText="取消"
                busy={busyAction === "batch-delete"}
                danger
                onCancel={onCancelBatchDelete}
                onConfirm={onConfirmBatchDelete}
            />
        </>
    );
}
