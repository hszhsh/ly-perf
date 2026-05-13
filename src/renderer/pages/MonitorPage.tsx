import { useEffect, useMemo } from "react";
import { MonitorChartsPanel } from "@renderer/components/MonitorChartsPanel";
import { MonitorPreviewPanel } from "@renderer/components/MonitorPreviewPanel";
import { MonitorSidebar } from "@renderer/components/MonitorSidebar";
import { useMonitorRuntime } from "@renderer/hooks/useMonitorRuntime";
import { useMonitorSettings } from "@renderer/hooks/useMonitorSettings";
import styles from "../styles/MonitorPage.module.css";

interface MonitorPageProps {
    onMonitorBusyChange?: (busy: boolean) => void;
}

export function MonitorPage({ onMonitorBusyChange }: MonitorPageProps) {
    const chartSyncGroup = "monitor-metric-charts";
    const {
        selectedSerial,
        setSelectedSerial,
        selectedPackage,
        setSelectedPackage,
        fpsMode,
        setFpsMode,
        cpuMode,
        setCpuMode,
        sampleIntervalMs,
        setSampleIntervalMs,
        screenshotEnabled,
        setScreenshotEnabled,
        screenshotIntervalMs,
        setScreenshotIntervalMs
    } = useMonitorSettings();
    const {
        runtimeInfo,
        devices,
        deviceInfo,
        apps,
        loadingApps,
        monitorState,
        samples,
        fpsDebug,
        capabilityReport,
        latestScreenshot,
        latestScreenshotUrl,
        isScreenshotLoading,
        isStarting,
        errorMessage,
        sessionEvents,
        eventBusyAction,
        eventErrorMessage,
        clearEventError,
        refreshDevices,
        refreshApps,
        handleStart,
        handleStop,
        handleCreateEvent,
        handleUpdateEvent,
        handleDeleteEvent
    } = useMonitorRuntime({
        selectedSerial,
        setSelectedSerial,
        selectedPackage,
        setSelectedPackage,
        fpsMode,
        setFpsMode,
        cpuMode,
        setCpuMode,
        sampleIntervalMs,
        setSampleIntervalMs,
        screenshotEnabled,
        setScreenshotEnabled,
        screenshotIntervalMs,
        setScreenshotIntervalMs
    });

    const activeCpuMode = monitorState.running
        ? (monitorState.config?.cpuMode ?? cpuMode)
        : cpuMode;
    const latestMetrics = samples[samples.length - 1]?.metrics;

    useEffect(() => {
        onMonitorBusyChange?.(isStarting || monitorState.running);
    }, [isStarting, monitorState.running, onMonitorBusyChange]);

    const appOptions = useMemo(
        () =>
            apps.map((app) => ({
                value: app.packageName,
                label: `${app.packageName}${app.isSystem ? " [system]" : ""}`,
                searchText: app.packageName
            })),
        [apps]
    );

    return (
        <section className={styles.page}>
            <MonitorSidebar
                runtimeInfo={runtimeInfo}
                devices={devices}
                deviceInfo={deviceInfo}
                selectedSerial={selectedSerial}
                onSelectedSerialChange={setSelectedSerial}
                onRefreshDevices={() => void refreshDevices()}
                appOptions={appOptions}
                selectedPackage={selectedPackage}
                onSelectedPackageChange={setSelectedPackage}
                loadingApps={loadingApps}
                onRefreshApps={() => void refreshApps(selectedSerial)}
                fpsMode={fpsMode}
                onFpsModeChange={setFpsMode}
                cpuMode={cpuMode}
                onCpuModeChange={setCpuMode}
                sampleIntervalMs={sampleIntervalMs}
                onSampleIntervalChange={setSampleIntervalMs}
                screenshotEnabled={screenshotEnabled}
                onScreenshotEnabledChange={setScreenshotEnabled}
                screenshotIntervalMs={screenshotIntervalMs}
                onScreenshotIntervalChange={setScreenshotIntervalMs}
                running={monitorState.running}
                isStarting={isStarting}
                errorMessage={errorMessage}
                onStart={() => void handleStart()}
                onStop={() => void handleStop()}
                fpsDebug={fpsDebug}
                capabilityReport={capabilityReport}
            />

            <div className={styles.content}>
                <MonitorChartsPanel
                    samples={samples}
                    activeCpuMode={activeCpuMode}
                    latestNetworkRx={latestMetrics?.networkRx}
                    latestNetworkTx={latestMetrics?.networkTx}
                    latestNetworkTotal={latestMetrics?.networkTotal}
                    syncGroup={chartSyncGroup}
                    events={sessionEvents}
                    editableEvents={monitorState.running}
                    eventBusyAction={eventBusyAction}
                    eventErrorMessage={eventErrorMessage}
                    onClearEventError={clearEventError}
                    onCreateEvent={handleCreateEvent}
                    onUpdateEvent={handleUpdateEvent}
                    onDeleteEvent={handleDeleteEvent}
                />

                <MonitorPreviewPanel
                    latestScreenshot={latestScreenshot}
                    latestScreenshotUrl={latestScreenshotUrl}
                    isScreenshotLoading={isScreenshotLoading}
                />
            </div>
        </section>
    );
}
