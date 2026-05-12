import { useEffect, useId, useRef, useState } from "react";
import { ModalDialog } from "./ModalDialog";
import styles from "./ModalDialog.module.css";

interface PromptDialogProps {
    open: boolean;
    title: string;
    description?: string;
    initialValue?: string;
    fieldLabel?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
    errorText?: string | null;
    busy?: boolean;
    onCancel: () => void;
    onConfirm: (value: string) => void;
}

export function PromptDialog(props: PromptDialogProps) {
    const {
        open,
        title,
        description,
        initialValue = "",
        fieldLabel,
        placeholder,
        confirmText = "确认",
        cancelText = "取消",
        errorText,
        busy,
        onCancel,
        onConfirm
    } = props;

    const [value, setValue] = useState(initialValue);
    const inputId = useId();
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        setValue(initialValue);

        const focusHandle = window.requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        });

        return () => {
            window.cancelAnimationFrame(focusHandle);
        };
    }, [initialValue, open]);

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
                        disabled={busy}
                        onClick={() => onConfirm(value)}
                    >
                        {confirmText}
                    </button>
                </>
            }
        >
            <form
                className={styles.field}
                onSubmit={(event) => {
                    event.preventDefault();
                    onConfirm(value);
                }}
            >
                {fieldLabel ? (
                    <label className={styles.fieldLabel} htmlFor={inputId}>
                        {fieldLabel}
                    </label>
                ) : null}
                <input
                    id={inputId}
                    ref={inputRef}
                    className={styles.textInput}
                    value={value}
                    placeholder={placeholder}
                    disabled={busy}
                    onChange={(event) => setValue(event.target.value)}
                />
                {errorText ? (
                    <p className={styles.errorText}>{errorText}</p>
                ) : null}
            </form>
        </ModalDialog>
    );
}
