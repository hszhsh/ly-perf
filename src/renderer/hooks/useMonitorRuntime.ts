import { useEffect, useMemo, useState } from "react";
import type {
    DeepMonitorChartDefinition,
    DeepMonitorMetricDefinition,
    DeepMonitorSample,
    DeviceInfo,
    FpsDebugInfo,
    InstalledApp,
    MetricCapabilityReport,
    MonitorConfig,
    MonitorSample,
    MonitorState,
    RuntimeInfo,
    SessionTimelineEvent,
    SessionTimelineEventInput,
    SessionTimelineEventUpdate,
    ConnectedDevice
} from "@shared/types";
import type { MonitorSettingsState } from "@renderer/hooks/useMonitorSettings";

type EventBusyAction = "capture" | "create" | "update" | "delete";

interface UseMonitorRuntimeResult {
    runtimeInfo: RuntimeInfo | null;
    devices: ConnectedDevice[];
    deviceInfo: DeviceInfo | null;
    apps: InstalledApp[];
    loadingApps: boolean;
    monitorState: MonitorState;
    samples: MonitorSample[];
    customMetricDefinitions: DeepMonitorMetricDefinition[];
    customChartDefinitions: DeepMonitorChartDefinition[];
    customSamples: DeepMonitorSample[];
    fpsDebug: FpsDebugInfo | null;
    capabilityReport: MetricCapabilityReport | null;
    latestScreenshot?: string;
    latestScreenshotUrl: string;
    isScreenshotLoading: boolean;
    isStarting: boolean;
    errorMessage: string;
    sessionEvents: SessionTimelineEvent[];
    eventBusyAction: EventBusyAction | null;
    eventErrorMessage: string;
    clearEventError: () => void;
    refreshDevices: () => Promise<void>;
    refreshApps: (serial: string) => Promise<void>;
    handleStart: () => Promise<void>;
    handleStop: () => Promise<void>;
    handleCaptureScreenshotEvent: () => Promise<boolean>;
    handleCreateEvent: (input: SessionTimelineEventInput) => Promise<boolean>;
    handleUpdateEvent: (input: SessionTimelineEventUpdate) => Promise<boolean>;
    handleDeleteEvent: (eventId: string) => Promise<boolean>;
}

export function useMonitorRuntime(
    settings: MonitorSettingsState
): UseMonitorRuntimeResult {
    const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
    const [devices, setDevices] = useState<ConnectedDevice[]>([]);
    const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
    const [apps, setApps] = useState<InstalledApp[]>([]);
    const [loadingApps, setLoadingApps] = useState(false);
    const [monitorState, setMonitorState] = useState<MonitorState>({
        running: false
    });
    const [samples, setSamples] = useState<MonitorSample[]>([]);
    const [customMetricDefinitions, setCustomMetricDefinitions] = useState<
        DeepMonitorMetricDefinition[]
    >([]);
    const [customChartDefinitions, setCustomChartDefinitions] = useState<
        DeepMonitorChartDefinition[]
    >([]);
    const [customSamples, setCustomSamples] = useState<DeepMonitorSample[]>([]);
    const [fpsDebug, setFpsDebug] = useState<FpsDebugInfo | null>(null);
    const [capabilityReport, setCapabilityReport] =
        useState<MetricCapabilityReport | null>(null);
    const [latestScreenshotUrl, setLatestScreenshotUrl] = useState("");
    const [isScreenshotLoading, setIsScreenshotLoading] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [sessionEvents, setSessionEvents] = useState<SessionTimelineEvent[]>(
        []
    );
    const [eventBusyAction, setEventBusyAction] = useState<EventBusyAction | null>(
        null
    );
    const [eventErrorMessage, setEventErrorMessage] = useState("");

    const latestScreenshot = useMemo(() => {
        for (let i = samples.length - 1; i >= 0; i -= 1) {
            const sample = samples[i];
            if (sample?.screenshotPath) {
                return sample.screenshotPath;
            }
        }

        return undefined;
    }, [samples]);

    async function refreshDevices(): Promise<void> {
        const list = await window.lyPerf.listDevices();
        setDevices(list);

        settings.setSelectedSerial((current) => {
            if (current && list.some((item) => item.serial === current)) {
                return current;
            }

            return list[0]?.serial ?? "";
        });
    }

    async function refreshApps(serial: string): Promise<void> {
        setLoadingApps(true);

        try {
            const list = await window.lyPerf.listInstalledApps(serial);
            setApps(list);

            settings.setSelectedPackage((current) => {
                if (
                    current &&
                    list.some((item) => item.packageName === current)
                ) {
                    return current;
                }

                return list[0]?.packageName ?? "";
            });
        } finally {
            setLoadingApps(false);
        }
    }

    useEffect(() => {
        let disposed = false;

        if (!latestScreenshot) {
            setLatestScreenshotUrl("");
            setIsScreenshotLoading(false);
            return () => {
                disposed = true;
            };
        }

        setIsScreenshotLoading(true);

        void (async () => {
            try {
                const dataUrl =
                    await window.lyPerf.readScreenshotDataUrl(latestScreenshot);
                if (!disposed) {
                    setLatestScreenshotUrl(dataUrl ?? "");
                    setIsScreenshotLoading(false);
                }
            } catch {
                if (!disposed) {
                    setLatestScreenshotUrl("");
                    setIsScreenshotLoading(false);
                }
            }
        })();

        return () => {
            disposed = true;
        };
    }, [latestScreenshot]);

    useEffect(() => {
        let cancelled = false;
        const disposeState = window.lyPerf.onMonitorStateChange((state) => {
            setMonitorState(state);
        });
        const disposeCustomSchema = window.lyPerf.onMonitorCustomSchema(
            (schema) => {
                setCustomMetricDefinitions(schema.metrics);
                setCustomChartDefinitions(schema.charts);
            }
        );
        const disposeCustomSamples = window.lyPerf.onMonitorCustomSamples(
            (nextSamples) => {
                setCustomSamples((prev) => {
                    const merged = [...prev, ...nextSamples];
                    if (merged.length > 7200) {
                        return merged.slice(merged.length - 7200);
                    }

                    return merged;
                });
            }
        );
        const dispose = window.lyPerf.onMonitorSample((sample) => {
            setSamples((prev) => {
                const next = [...prev, sample];
                if (next.length > 3600) {
                    return next.slice(next.length - 3600);
                }

                return next;
            });

            if (sample.fpsDebug) {
                setFpsDebug(sample.fpsDebug);
            }

            if (sample.capabilityReport) {
                setCapabilityReport(sample.capabilityReport);
            }
        });

        void (async () => {
            const [runtime, state, report] = await Promise.all([
                window.lyPerf.getRuntimeInfo(),
                window.lyPerf.getMonitorState(),
                window.lyPerf.getMonitorCapabilityReport()
            ]);
            if (cancelled) {
                return;
            }

            setRuntimeInfo(runtime);
            setMonitorState(state);
            if (state.config?.serial) {
                settings.setSelectedSerial(state.config.serial);
            }
            if (state.config?.packageName) {
                settings.setSelectedPackage(state.config.packageName);
            }
            if (state.config?.fpsMode) {
                settings.setFpsMode(state.config.fpsMode);
            }
            if (state.config?.cpuMode) {
                settings.setCpuMode(state.config.cpuMode);
            }
            settings.setDeepMonitorEnabled(
                Boolean(state.config?.deepMonitor?.enabled)
            );
            if (typeof state.config?.sampleIntervalMs === "number") {
                settings.setSampleIntervalMs(state.config.sampleIntervalMs);
            }
            if (typeof state.config?.screenshotEnabled === "boolean") {
                settings.setScreenshotEnabled(state.config.screenshotEnabled);
            }
            if (typeof state.config?.screenshotIntervalMs === "number") {
                settings.setScreenshotIntervalMs(
                    state.config.screenshotIntervalMs
                );
            }
            if (report) {
                setCapabilityReport(report);
                setFpsDebug(report.fps);
            }

            if (state.sessionId) {
                try {
                    const detail = await window.lyPerf.getSession(state.sessionId);
                    if (!cancelled) {
                        setSessionEvents(detail.events);
                        setCustomMetricDefinitions(
                            detail.customMetricDefinitions ?? []
                        );
                        setCustomChartDefinitions(
                            detail.customChartDefinitions ?? []
                        );
                        setCustomSamples(detail.customSamples ?? []);
                    }
                } catch {
                    if (!cancelled) {
                        setSessionEvents([]);
                        setCustomMetricDefinitions([]);
                        setCustomChartDefinitions([]);
                        setCustomSamples([]);
                    }
                }
            } else {
                setSessionEvents([]);
                setCustomMetricDefinitions([]);
                setCustomChartDefinitions([]);
                setCustomSamples([]);
            }

            await refreshDevices();
        })();

        return () => {
            cancelled = true;
            disposeState();
            disposeCustomSchema();
            disposeCustomSamples();
            dispose();
        };
    }, []);

    useEffect(() => {
        if (!settings.selectedSerial) {
            setDeviceInfo(null);
            setApps([]);
            settings.setSelectedPackage("");
            setCapabilityReport(null);
            setFpsDebug(null);
            return;
        }

        void (async () => {
            const [info] = await Promise.all([
                window.lyPerf.getDeviceInfo(settings.selectedSerial),
                refreshApps(settings.selectedSerial)
            ]);

            setDeviceInfo(info);
        })();
    }, [settings.selectedSerial]);

    async function handleStart(): Promise<void> {
        if (isStarting) {
            return;
        }

        if (!settings.selectedSerial) {
            setErrorMessage(
                "未检测到可用设备，请先连接安卓设备。\n可执行 adb devices 确认连接。"
            );
            return;
        }

        if (!settings.selectedPackage) {
            setErrorMessage(
                "请选择需要监控的应用包名。\n如果列表为空，请先刷新应用列表。"
            );
            return;
        }

        setErrorMessage("");
        setIsStarting(true);
        setSamples([]);
        setCustomMetricDefinitions([]);
        setCustomChartDefinitions([]);
        setCustomSamples([]);
        setSessionEvents([]);
        setFpsDebug(null);
        setCapabilityReport(null);
        setEventErrorMessage("");

        const config: MonitorConfig = {
            serial: settings.selectedSerial,
            packageName: settings.selectedPackage,
            fpsMode: settings.fpsMode,
            cpuMode: settings.cpuMode,
            deepMonitor: settings.deepMonitorEnabled
                ? {
                      enabled: true,
                      transport: "tcp",
                      socketKind: "raw-tcp"
                  }
                : undefined,
            sampleIntervalMs: settings.sampleIntervalMs,
            screenshotEnabled: settings.screenshotEnabled,
            screenshotIntervalMs: settings.screenshotIntervalMs
        };

        try {
            const state = await window.lyPerf.startMonitor(config);
            setMonitorState(state);
            setIsStarting(false);
        } catch (error) {
            setIsStarting(false);
            setErrorMessage(
                error instanceof Error ? error.message : "启动监控失败。"
            );
        }
    }

    async function handleStop(): Promise<void> {
        const state = await window.lyPerf.stopMonitor();
        setMonitorState(state);
        setSamples([]);
        setCustomMetricDefinitions([]);
        setCustomChartDefinitions([]);
        setCustomSamples([]);
        setSessionEvents([]);
        setFpsDebug(null);
        setCapabilityReport(null);
        setEventErrorMessage("");
    }

    function clearEventError(): void {
        setEventErrorMessage("");
    }

    async function mutateSessionEvent(
        action: EventBusyAction,
        fallbackMessage: string,
        handler: (sessionId: string) => Promise<{ events: SessionTimelineEvent[] }>
    ): Promise<boolean> {
        const sessionId = monitorState.sessionId;
        if (!sessionId) {
            setEventErrorMessage("当前没有运行中的会话，无法编辑时间轴事件。");
            return false;
        }

        setEventBusyAction(action);

        try {
            const updated = await handler(sessionId);
            setSessionEvents(updated.events);
            setEventErrorMessage("");
            return true;
        } catch (error) {
            setEventErrorMessage(
                error instanceof Error && error.message
                    ? error.message
                    : fallbackMessage
            );
            return false;
        } finally {
            setEventBusyAction(null);
        }
    }

    async function handleCreateEvent(
        input: SessionTimelineEventInput
    ): Promise<boolean> {
        return mutateSessionEvent("create", "新增时间轴事件失败。", (sessionId) =>
            window.lyPerf.createSessionEvent(sessionId, input)
        );
    }

    async function handleCaptureScreenshotEvent(): Promise<boolean> {
        return mutateSessionEvent("capture", "截图事件添加失败。", (sessionId) =>
            window.lyPerf.captureSessionScreenshotEvent(sessionId)
        );
    }

    async function handleUpdateEvent(
        input: SessionTimelineEventUpdate
    ): Promise<boolean> {
        return mutateSessionEvent("update", "更新时间轴事件失败。", (sessionId) =>
            window.lyPerf.updateSessionEvent(sessionId, input)
        );
    }

    async function handleDeleteEvent(eventId: string): Promise<boolean> {
        return mutateSessionEvent("delete", "删除时间轴事件失败。", (sessionId) =>
            window.lyPerf.deleteSessionEvent(sessionId, eventId)
        );
    }

    return {
        runtimeInfo,
        devices,
        deviceInfo,
        apps,
        loadingApps,
        monitorState,
        samples,
        customMetricDefinitions,
        customChartDefinitions,
        customSamples,
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
        handleCaptureScreenshotEvent,
        handleCreateEvent,
        handleUpdateEvent,
        handleDeleteEvent
    };
}
