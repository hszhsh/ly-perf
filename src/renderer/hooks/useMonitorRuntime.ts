import { useEffect, useMemo, useState } from "react";
import type {
    DeviceInfo,
    FpsDebugInfo,
    InstalledApp,
    MetricCapabilityReport,
    MonitorConfig,
    MonitorSample,
    MonitorState,
    RuntimeInfo,
    ConnectedDevice
} from "@shared/types";
import type { MonitorSettingsState } from "@renderer/hooks/useMonitorSettings";

interface UseMonitorRuntimeResult {
    runtimeInfo: RuntimeInfo | null;
    devices: ConnectedDevice[];
    deviceInfo: DeviceInfo | null;
    apps: InstalledApp[];
    loadingApps: boolean;
    monitorState: MonitorState;
    samples: MonitorSample[];
    fpsDebug: FpsDebugInfo | null;
    capabilityReport: MetricCapabilityReport | null;
    latestScreenshot?: string;
    latestScreenshotUrl: string;
    isScreenshotLoading: boolean;
    isStarting: boolean;
    errorMessage: string;
    refreshDevices: () => Promise<void>;
    refreshApps: (serial: string) => Promise<void>;
    handleStart: () => Promise<void>;
    handleStop: () => Promise<void>;
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
    const [fpsDebug, setFpsDebug] = useState<FpsDebugInfo | null>(null);
    const [capabilityReport, setCapabilityReport] =
        useState<MetricCapabilityReport | null>(null);
    const [latestScreenshotUrl, setLatestScreenshotUrl] = useState("");
    const [isScreenshotLoading, setIsScreenshotLoading] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

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
            await refreshDevices();
        })();

        return dispose;
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
        setFpsDebug(null);
        setCapabilityReport(null);

        const config: MonitorConfig = {
            serial: settings.selectedSerial,
            packageName: settings.selectedPackage,
            fpsMode: settings.fpsMode,
            cpuMode: settings.cpuMode,
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
    }

    return {
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
        refreshDevices,
        refreshApps,
        handleStart,
        handleStop
    };
}
