import { ReportsChartsPanel } from "@renderer/components/ReportsChartsPanel";
import { ReportsSessionDialogs } from "@renderer/components/ReportsSessionDialogs";
import { ToastViewport } from "@renderer/components/ToastViewport";
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
        eventBusyAction,
        eventErrorMessage,
        clearFeedback,
        clearEventError,
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
        handleDelete,
        handleUpdateEvent,
        handleDeleteEvent
    } = useReportsRuntime();

    const controlsDisabled =
        refreshing ||
        busyAction !== null ||
        renameDialogOpen ||
        deleteDialogOpen;
    const latestMetrics =
        sessionDetail?.samples[sessionDetail.samples.length - 1]?.metrics;
    const {
        screenshotSampleIndexes,
        selectedScreenshotPosition,
        selectedScreenshotSample,
        screenshotPreviewItems,
        handleChartSampleFocus,
        handleChartTimestampFocus,
        jumpScreenshot
    } = useReportsScreenshots(sessionDetail);
    const {
        restoredVisibleTimeRange,
        normalizedLoadChartRange,
        loadChartStats,
        customChartRangesById,
        customChartStatsCards,
        handleVisibleTimeRangeChange,
        handleLoadChartRangeChange,
        handleCustomChartRangeChange
    } = useReportsChartRange(sessionDetail);
    const feedbackToasts = feedback
        ? [
              {
                  id: String(feedback.id),
                  title: feedback.type === "error" ? "操作失败" : "操作完成",
                  description: feedback.text,
                  tone: feedback.type,
                  durationMs: feedback.type === "error" ? 5200 : 3200
              }
          ]
        : [];

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
                            onExportCsv={() => void handleExport("csv")}
                            onExportXlsx={() => void handleExport("xlsx")}
                        />
                        <div className={styles.detailBody}>
                            <ReportsChartsPanel
                                key={sessionDetail.id}
                                sessionDetail={sessionDetail}
                                restoredVisibleTimeRange={
                                    restoredVisibleTimeRange
                                }
                                normalizedLoadChartRange={
                                    normalizedLoadChartRange
                                }
                                loadChartStats={loadChartStats}
                                onSampleFocus={handleChartSampleFocus}
                                onCustomTimestampFocus={
                                    handleChartTimestampFocus
                                }
                                onVisibleTimeRangeChange={
                                    handleVisibleTimeRangeChange
                                }
                                onLoadChartRangeChange={
                                    handleLoadChartRangeChange
                                }
                                customChartRangesById={customChartRangesById}
                                customChartStatsCards={customChartStatsCards}
                                onCustomChartRangeChange={
                                    handleCustomChartRangeChange
                                }
                                eventBusyAction={eventBusyAction}
                                eventErrorMessage={eventErrorMessage}
                                onClearEventError={clearEventError}
                                onUpdateEvent={handleUpdateEvent}
                                onDeleteEvent={handleDeleteEvent}
                            />

                            <ReportsScreenshotPreview
                                selectedScreenshotSample={
                                    selectedScreenshotSample
                                }
                                selectedScreenshotPosition={
                                    selectedScreenshotPosition
                                }
                                screenshotCount={screenshotSampleIndexes.length}
                                screenshotPreviewItems={
                                    screenshotPreviewItems
                                }
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

            <ToastViewport
                toasts={feedbackToasts}
                onDismiss={() => clearFeedback()}
            />
        </section>
    );
}
