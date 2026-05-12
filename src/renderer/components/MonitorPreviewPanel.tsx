import styles from "@renderer/styles/MonitorPage.module.css";

interface MonitorPreviewPanelProps {
    latestScreenshot?: string;
    latestScreenshotUrl: string;
    isScreenshotLoading: boolean;
}

export function MonitorPreviewPanel({
    latestScreenshot,
    latestScreenshotUrl,
    isScreenshotLoading
}: MonitorPreviewPanelProps) {
    return (
        <section className={styles.preview}>
            <h3>截图预览</h3>
            {latestScreenshotUrl ? (
                <img
                    className={styles.previewImage}
                    src={latestScreenshotUrl}
                    alt="latest screenshot"
                />
            ) : isScreenshotLoading ? (
                <p className={styles.placeholder}>截图加载中...</p>
            ) : latestScreenshot ? (
                <p className={styles.placeholder}>
                    截图加载失败，文件可能已不存在或不可访问。
                </p>
            ) : (
                <p className={styles.placeholder}>
                    当前暂无截图。可开启截图功能并启动监控后查看。
                </p>
            )}
        </section>
    );
}
