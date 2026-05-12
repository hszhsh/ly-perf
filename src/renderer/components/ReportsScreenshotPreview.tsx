import type { SessionDetail } from "@shared/types";
import { formatDateTime } from "@renderer/utils/formatters";
import styles from "@renderer/styles/ReportsPage.module.css";

interface ReportsScreenshotPreviewProps {
    selectedScreenshotSample: SessionDetail["samples"][number] | null;
    selectedScreenshotPosition: number;
    screenshotCount: number;
    selectedScreenshotUrl: string;
    isScreenshotLoading: boolean;
    onPreviousScreenshot: () => void;
    onNextScreenshot: () => void;
}

export function ReportsScreenshotPreview({
    selectedScreenshotSample,
    selectedScreenshotPosition,
    screenshotCount,
    selectedScreenshotUrl,
    isScreenshotLoading,
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

                    {selectedScreenshotUrl ? (
                        <img
                            className={styles.previewImage}
                            src={selectedScreenshotUrl}
                            alt={`session screenshot at ${formatDateTime(selectedScreenshotSample.timestamp)}`}
                        />
                    ) : isScreenshotLoading ? (
                        <p className={styles.empty}>截图加载中...</p>
                    ) : (
                        <p className={styles.empty}>
                            截图加载失败，文件可能已不存在或不可访问。
                        </p>
                    )}
                </>
            ) : (
                <p className={styles.empty}>
                    该历史会话没有可预览截图。开启截图采样后再开始监控即可保留历史截图。
                </p>
            )}
        </section>
    );
}
