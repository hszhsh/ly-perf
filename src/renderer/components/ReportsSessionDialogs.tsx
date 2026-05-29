import { ConfirmDialog } from "@renderer/components/ConfirmDialog";
import { PromptDialog } from "@renderer/components/PromptDialog";

interface ReportsSessionDialogsProps {
    sessionDisplayName: string;
    renameDialogOpen: boolean;
    renameDialogError: string | null;
    deleteDialogOpen: boolean;
    busyAction:
        | "delete"
        | "export-html"
        | "export-xlsx"
        | "export-csv"
        | "rename"
        | null;
    onCancelRename: () => void;
    onConfirmRename: (value: string) => void;
    onCancelDelete: () => void;
    onConfirmDelete: () => void;
}

export function ReportsSessionDialogs({
    sessionDisplayName,
    renameDialogOpen,
    renameDialogError,
    deleteDialogOpen,
    busyAction,
    onCancelRename,
    onConfirmRename,
    onCancelDelete,
    onConfirmDelete
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
        </>
    );
}
