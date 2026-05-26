import { useEffect, useRef } from "react";
import { LayerPortal } from "@renderer/components/LayerPortal";
import styles from "./ToastViewport.module.css";

export type ToastTone = "success" | "error" | "info";

export interface ToastItem {
    id: string;
    title?: string;
    description: string;
    tone?: ToastTone;
    durationMs?: number;
}

interface ToastViewportProps {
    toasts: ToastItem[];
    onDismiss: (toastId: string) => void;
}

function getToastTitle(tone: ToastTone): string {
    switch (tone) {
        case "success":
            return "操作完成";
        case "error":
            return "操作失败";
        default:
            return "提示";
    }
}

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
    const timeoutHandlesRef = useRef(new Map<string, number>());

    useEffect(() => {
        const timeoutHandles = timeoutHandlesRef.current;
        const activeToastIds = new Set(toasts.map((toast) => toast.id));

        for (const [toastId, handle] of timeoutHandles.entries()) {
            if (activeToastIds.has(toastId)) {
                continue;
            }

            window.clearTimeout(handle);
            timeoutHandles.delete(toastId);
        }

        for (const toast of toasts) {
            const durationMs = toast.durationMs ?? 0;

            if (durationMs <= 0 || timeoutHandles.has(toast.id)) {
                continue;
            }

            const handle = window.setTimeout(() => {
                timeoutHandles.delete(toast.id);
                onDismiss(toast.id);
            }, durationMs);

            timeoutHandles.set(toast.id, handle);
        }
    }, [onDismiss, toasts]);

    useEffect(() => {
        return () => {
            for (const handle of timeoutHandlesRef.current.values()) {
                window.clearTimeout(handle);
            }

            timeoutHandlesRef.current.clear();
        };
    }, []);

    if (toasts.length === 0) {
        return null;
    }

    return (
        <LayerPortal layer="toast">
            <div
                className={styles.viewport}
                aria-atomic="false"
                aria-live="polite"
                aria-relevant="additions text"
            >
                {toasts.map((toast) => {
                    const tone = toast.tone ?? "info";

                    return (
                        <section
                            key={toast.id}
                            className={styles.toast}
                            data-tone={tone}
                        >
                            <div className={styles.header}>
                                <strong className={styles.title}>
                                    {toast.title ?? getToastTitle(tone)}
                                </strong>
                                <button
                                    type="button"
                                    className={styles.dismissButton}
                                    onClick={() => onDismiss(toast.id)}
                                    aria-label="关闭提示"
                                >
                                    ×
                                </button>
                            </div>
                            <p className={styles.description}>
                                {toast.description}
                            </p>
                        </section>
                    );
                })}
            </div>
        </LayerPortal>
    );
}