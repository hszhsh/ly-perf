import { ReportsChartsPanel } from "@renderer/components/ReportsChartsPanel";
import { ReportsSessionDialogs } from "@renderer/components/ReportsSessionDialogs";
import { useReportsChartRange } from "@renderer/hooks/useReportsChartRange";
import { useReportsRuntime } from "@renderer/hooks/useReportsRuntime";
import { useReportsScreenshots } from "@renderer/hooks/useReportsScreenshots";
import { ReportsScreenshotPreview } from "@renderer/components/ReportsScreenshotPreview";
import { ReportsSessionList } from "@renderer/components/ReportsSessionList";
import { ReportsSessionOverview } from "@renderer/components/ReportsSessionOverview";
import styles from "../styles/ReportsPage.module.css";

export function ReportsPage() {
    const {
        sessions,
        selectedSessionId,
        sessionDetail,
        exportResult,
        feedback,
        busyAction,
        refreshing,
        renameDialogOpen,
        renameDialogError,
        deleteDialogOpen,
        reloadSessions,
        setSelectedSessionId,
        handleExport,
        openRenameDialog,
        closeRenameDialog,
        handleRename,
        openDeleteDialog,
        closeDeleteDialog,
        handleDelete
    } = useReportsRuntime();

    const controlsDisabled =
        refreshing ||
        busyAction !== null ||
        renameDialogOpen ||
        deleteDialogOpen;
    const latestMetrics =
        sessionDetail?.samples[sessionDetail.samples.length - 1]?.metrics;
    const chartSyncGroup = sessionDetail
        ? `report-metric-charts-${sessionDetail.id}`
        : undefined;
    const {
        screenshotSampleIndexes,
        selectedScreenshotPosition,
        selectedScreenshotSample,
        selectedScreenshotUrl,
        isScreenshotLoading,
        handleChartSampleFocus,
        jumpScreenshot
    } = useReportsScreenshots(sessionDetail);
    const {
        normalizedLoadChartRange,
        loadChartStats,
        handleLoadChartRangeChange
    } = useReportsChartRange(sessionDetail);

    return (
        <section className={styles.page}>
            <ReportsSessionList
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                controlsDisabled={controlsDisabled}
                refreshing={refreshing}
                onRefresh={() => void reloadSessions()}
                onSelectSession={setSelectedSessionId}
            />

            <div className={styles.content}>
                {feedback ? (
                    <p
                        className={
                            feedback.type === "error"
                                ? styles.errorMessage
                                : styles.statusMessage
                        }
                    >
                        {feedback.text}
                    </p>
                ) : null}

                {sessionDetail ? (
                    <>
                        <ReportsSessionOverview
                            sessionDetail={sessionDetail}
                            exportResult={exportResult}
                            controlsDisabled={controlsDisabled}
                            latestTotalTrafficMb={
                                latestMetrics?.networkTotal?.value
                            }
                            onRename={openRenameDialog}
                            onDelete={openDeleteDialog}
                            onExportHtml={() => void handleExport("html")}
                            onExportXlsx={() => void handleExport("xlsx")}
                        />
                        <div className={styles.detailBody}>
                            <ReportsChartsPanel
                                sessionDetail={sessionDetail}
                                chartSyncGroup={chartSyncGroup}
                                normalizedLoadChartRange={
                                    normalizedLoadChartRange
                                }
                                loadChartStats={loadChartStats}
                                onSampleFocus={handleChartSampleFocus}
                                onLoadChartRangeChange={
                                    handleLoadChartRangeChange
                                }
                            />

                            <ReportsScreenshotPreview
                                selectedScreenshotSample={
                                    selectedScreenshotSample
                                }
                                selectedScreenshotPosition={
                                    selectedScreenshotPosition
                                }
                                screenshotCount={screenshotSampleIndexes.length}
                                selectedScreenshotUrl={selectedScreenshotUrl}
                                isScreenshotLoading={isScreenshotLoading}
                                onPreviousScreenshot={() => jumpScreenshot(-1)}
                                onNextScreenshot={() => jumpScreenshot(1)}
                            />
                        </div>
                    </>
                ) : (
                    <p className={styles.empty}>
                        请选择左侧会话查看详情和导出。
                    </p>
                )}

                <ReportsSessionDialogs
                    sessionDisplayName={sessionDetail?.displayName ?? ""}
                    renameDialogOpen={renameDialogOpen}
                    renameDialogError={renameDialogError}
                    deleteDialogOpen={deleteDialogOpen}
                    busyAction={busyAction}
                    onCancelRename={closeRenameDialog}
                    onConfirmRename={(value) => {
                        void handleRename(value);
                    }}
                    onCancelDelete={closeDeleteDialog}
                    onConfirmDelete={() => {
                        void handleDelete();
                    }}
                />
            </div>
        </section>
    );
}
