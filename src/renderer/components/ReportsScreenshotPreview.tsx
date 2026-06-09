import type { SessionDetail } from "@shared/types";
import { formatDateTime } from "@renderer/utils/formatters";
import type { ScreenshotPreviewItem } from "@renderer/hooks/useReportsScreenshots";
import styles from "@renderer/styles/ReportsPage.module.css";

interface ReportsScreenshotPreviewProps {
    selectedScreenshotSample: SessionDetail["samples"][number] | null;
    selectedScreenshotPosition: number;
    screenshotCount: number;
    screenshotPreviewItems: [
        ScreenshotPreviewItem,
        ScreenshotPreviewItem,
        ScreenshotPreviewItem
    ];
    onPreviousScreenshot: () => void;
    onNextScreenshot: () => void;
}

function renderPreviewSlot(
    item: ScreenshotPreviewItem,
    screenshotCount: number
) {
    if (!item.sample) {
        return <p className={styles.previewSlotPlaceholder}>无截图</p>;
    }

    if (item.url) {
        return (
            <img
                className={styles.previewImage}
                src={item.url}
                alt={`session screenshot at ${formatDateTime(item.sample.timestamp)}`}
            />
        );
    }

    if (item.isLoading) {
        return <p className={styles.previewSlotPlaceholder}>截图加载中...</p>;
    }

    return (
        <p className={styles.previewSlotPlaceholder}>
            第 {item.position + 1} / {screenshotCount} 张截图加载失败
        </p>
    );
}

export function ReportsScreenshotPreview({
    selectedScreenshotSample,
    selectedScreenshotPosition,
    screenshotCount,
    screenshotPreviewItems,
    onPreviousScreenshot,
    onNextScreenshot
}: ReportsScreenshotPreviewProps) {
    return (
        <section className={styles.previewSection}>
            <div className={styles.sectionHeader}>
                <h4>截图预览</h4>
                <span>悬停或点击趋势图，会自动跳到最近一张截图。</span>
            </div>

            {selectedScreenshotSample ? (
                <>
                    <div className={styles.previewToolbar}>
                        <div className={styles.previewMeta}>
                            <strong>
                                {formatDateTime(selectedScreenshotSample.timestamp)}
                            </strong>
                            <span>
                                第 {selectedScreenshotPosition + 1} /{" "}
                                {screenshotCount} 张截图
                            </span>
                        </div>

                        <div className={styles.previewActions}>
                            <button
                                type="button"
                                disabled={selectedScreenshotPosition <= 0}
                                onClick={onPreviousScreenshot}
                            >
                                上一张
                            </button>
                            <button
                                type="button"
                                disabled={
                                    selectedScreenshotPosition < 0 ||
                                    selectedScreenshotPosition >=
                                        screenshotCount - 1
                                }
                                onClick={onNextScreenshot}
                            >
                                下一张
                            </button>
                        </div>
                    </div>

                    <div className={styles.previewMediaRow}>
                        {screenshotPreviewItems.map((item) => (
                            <div
                                key={`${item.kind}-${item.sample?.timestamp ?? "none"}`}
                                className={
                                    item.kind === "current"
                                        ? styles.previewMediaCurrent
                                        : styles.previewMediaSide
                                }
                            >
                                {renderPreviewSlot(item, screenshotCount)}
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <p className={styles.empty}>
                    该历史会话没有可预览截图。开启截图采样后再开始监控即可保留历史截图。
                </p>
            )}
        </section>
    );
}
