import { type ReactNode, useEffect, useId, useRef } from "react";
import { LayerPortal } from "@renderer/components/LayerPortal";
import styles from "./ModalDialog.module.css";

interface ModalDialogProps {
    open: boolean;
    title: string;
    description?: string;
    children?: ReactNode;
    footer?: ReactNode;
    closeLabel?: string;
    dialogClassName?: string;
    bodyClassName?: string;
    onClose?: () => void;
}

export function ModalDialog(props: ModalDialogProps) {
    const {
        open,
        title,
        description,
        children,
        footer,
        closeLabel = "关闭",
        dialogClassName,
        bodyClassName,
        onClose
    } = props;
    const titleId = useId();
    const descriptionId = useId();
    const dialogRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open || !onClose) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") {
                return;
            }

            event.preventDefault();
            onClose();
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [open, onClose]);

    useEffect(() => {
        if (!open) {
            return;
        }

        const previousOverflow = document.body.style.overflow;
        const activeElement = document.activeElement as HTMLElement | null;
        const focusHandle = window.requestAnimationFrame(() => {
            dialogRef.current?.focus();
        });

        document.body.style.overflow = "hidden";

        return () => {
            window.cancelAnimationFrame(focusHandle);
            document.body.style.overflow = previousOverflow;
            activeElement?.focus?.();
        };
    }, [open]);

    if (!open) {
        return null;
    }

    return (
        <LayerPortal layer="modal">
            <div
                className={styles.backdrop}
                onMouseDown={(event) => {
                    if (event.target === event.currentTarget) {
                        onClose?.();
                    }
                }}
            >
                <div
                    ref={dialogRef}
                    className={`${styles.dialog} ${dialogClassName ?? ""}`.trim()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    aria-describedby={description ? descriptionId : undefined}
                    tabIndex={-1}
                >
                    <div className={styles.header}>
                        <div>
                            <h3 id={titleId} className={styles.title}>
                                {title}
                            </h3>
                            {description ? (
                                <p
                                    id={descriptionId}
                                    className={styles.description}
                                >
                                    {description}
                                </p>
                            ) : null}
                        </div>

                        {onClose ? (
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={onClose}
                                aria-label={closeLabel}
                            >
                                ×
                            </button>
                        ) : null}
                    </div>

                    {children ? (
                        <div
                            className={`${styles.body} ${bodyClassName ?? ""}`.trim()}
                        >
                            {children}
                        </div>
                    ) : null}
                    {footer ? (
                        <div className={styles.footer}>{footer}</div>
                    ) : null}
                </div>
            </div>
        </LayerPortal>
    );
}
