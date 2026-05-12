import { ModalDialog } from "./ModalDialog";
import styles from "./ModalDialog.module.css";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  busy?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const {
    open,
    title,
    description,
    message,
    confirmText = "确认",
    cancelText = "取消",
    busy,
    danger,
    onCancel,
    onConfirm
  } = props;

  return (
    <ModalDialog
      open={open}
      title={title}
      description={description}
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <button type="button" disabled={busy} onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={danger ? styles.dangerAction : undefined}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <p className={styles.bodyText}>{message}</p>
    </ModalDialog>
  );
}