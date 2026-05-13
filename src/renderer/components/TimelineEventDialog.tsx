import { useEffect, useRef, useState } from "react";
import type {
    SessionTimelineEvent,
    SessionTimelineEventInput
} from "@shared/types";
import { ModalDialog } from "@renderer/components/ModalDialog";
import {
    TIMELINE_EVENT_TYPE_PRESETS,
    getTimelineEventDefaultColor,
    getTimelineEventTypeLabel
} from "@renderer/components/timelineEventPresets";
import styles from "@renderer/components/TimelineEventsPanel.module.css";

function toDateTimeLocalValue(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function parseDateTimeLocalValue(value: string): number | null {
    if (!value.trim()) {
        return null;
    }

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

function formatBound(timestamp: number | null | undefined): string {
    if (timestamp === null || timestamp === undefined) {
        return "N/A";
    }

    return new Date(timestamp).toLocaleString();
}

interface TimelineEventDialogProps {
    open: boolean;
    mode: "create" | "edit";
    initialValue: SessionTimelineEvent | SessionTimelineEventInput | null;
    busy?: boolean;
    errorText?: string | null;
    minTimestamp?: number | null;
    maxTimestamp?: number | null;
    onCancel: () => void;
    onConfirm: (input: SessionTimelineEventInput) => void;
}

export function TimelineEventDialog({
    open,
    mode,
    initialValue,
    busy,
    errorText,
    minTimestamp,
    maxTimestamp,
    onCancel,
    onConfirm
}: TimelineEventDialogProps) {
    const [timestampInput, setTimestampInput] = useState("");
    const [type, setType] = useState<SessionTimelineEventInput["type"]>(
        "note"
    );
    const [color, setColor] = useState(getTimelineEventDefaultColor("note"));
    const [text, setText] = useState("");
    const [localError, setLocalError] = useState<string | null>(null);
    const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        if (!open || !initialValue) {
            return;
        }

        setTimestampInput(toDateTimeLocalValue(initialValue.timestamp));
        setType(initialValue.type);
        setColor(initialValue.color);
        setText(initialValue.text);
        setLocalError(null);

        const focusHandle = window.requestAnimationFrame(() => {
            textAreaRef.current?.focus();
            textAreaRef.current?.select();
        });

        return () => {
            window.cancelAnimationFrame(focusHandle);
        };
    }, [initialValue, open]);

    const confirmText =
        mode === "create"
            ? busy
                ? "添加中..."
                : "添加事件"
            : busy
              ? "保存中..."
              : "保存修改";

    function handleSubmit(): void {
        const timestamp = parseDateTimeLocalValue(timestampInput);
        if (timestamp === null) {
            setLocalError("请输入有效的事件时间。");
            return;
        }

        if (minTimestamp !== null && minTimestamp !== undefined) {
            if (timestamp < minTimestamp) {
                setLocalError(
                    `事件时间不能早于当前时间轴起点（${formatBound(minTimestamp)}）。`
                );
                return;
            }
        }

        if (maxTimestamp !== null && maxTimestamp !== undefined) {
            if (timestamp > maxTimestamp) {
                setLocalError(
                    `事件时间不能晚于当前时间轴终点（${formatBound(maxTimestamp)}）。`
                );
                return;
            }
        }

        if (!text.trim()) {
            setLocalError("事件内容不能为空。");
            return;
        }

        setLocalError(null);
        onConfirm({
            timestamp,
            type,
            color,
            text: text.trim()
        });
    }

    return (
        <ModalDialog
            open={open}
            title={mode === "create" ? "添加时间轴事件" : "编辑时间轴事件"}
            description={
                mode === "create"
                    ? "事件会显示在当前会话的全部图表上。"
                    : "修改后会同步更新当前会话的全部图表。"
            }
            onClose={busy ? undefined : onCancel}
            footer={
                <>
                    <button type="button" disabled={busy} onClick={onCancel}>
                        取消
                    </button>
                    <button type="button" disabled={busy} onClick={handleSubmit}>
                        {confirmText}
                    </button>
                </>
            }
        >
            <form
                className={styles.form}
                onSubmit={(event) => {
                    event.preventDefault();
                    handleSubmit();
                }}
            >
                <div className={styles.fieldGrid}>
                    <div className={styles.row}>
                        <label className={styles.fieldLabel}>
                            <span>事件时间</span>
                            <input
                                type="datetime-local"
                                step="0.001"
                                className={styles.textInput}
                                value={timestampInput}
                                disabled={busy}
                                onChange={(event) =>
                                    setTimestampInput(event.target.value)
                                }
                            />
                        </label>

                        <label className={styles.fieldLabel}>
                            <span>事件类型</span>
                            <select
                                className={styles.selectInput}
                                value={type}
                                disabled={busy}
                                onChange={(event) => {
                                    const nextType =
                                        event.target.value as SessionTimelineEventInput["type"];
                                    setType(nextType);
                                    setColor(
                                        getTimelineEventDefaultColor(nextType)
                                    );
                                }}
                            >
                                {TIMELINE_EVENT_TYPE_PRESETS.map((preset) => (
                                    <option key={preset.type} value={preset.type}>
                                        {preset.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className={styles.row}>
                        <label className={styles.fieldLabel}>
                            <span>事件颜色</span>
                            <input
                                type="color"
                                className={styles.colorInput}
                                value={color}
                                disabled={busy}
                                onChange={(event) =>
                                    setColor(event.target.value)
                                }
                            />
                        </label>

                        <div className={styles.fieldLabel}>
                            <span>类型说明</span>
                            <p className={styles.helperText}>
                                {
                                    TIMELINE_EVENT_TYPE_PRESETS.find(
                                        (preset) => preset.type === type
                                    )?.description
                                }
                            </p>
                        </div>
                    </div>

                    <label className={styles.fieldLabel}>
                        <span>
                            事件内容（{getTimelineEventTypeLabel(type)}）
                        </span>
                        <textarea
                            ref={textAreaRef}
                            className={styles.textArea}
                            value={text}
                            disabled={busy}
                            placeholder="例如：点击开始战斗、进入结算界面、出现明显掉帧。"
                            onChange={(event) => setText(event.target.value)}
                        />
                    </label>
                </div>

                {minTimestamp !== null || maxTimestamp !== null ? (
                    <p className={styles.helperText}>
                        可选范围: {formatBound(minTimestamp)} - {formatBound(maxTimestamp)}
                    </p>
                ) : null}

                {localError || errorText ? (
                    <p className={styles.error}>{localError ?? errorText}</p>
                ) : null}
            </form>
        </ModalDialog>
    );
}