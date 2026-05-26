import { useEffect, useState } from "react";
import type { CpuUsageMode, FpsMode } from "@shared/types";

export interface PersistedMonitorSettings {
    selectedSerial: string;
    selectedPackage: string;
    fpsMode: FpsMode;
    cpuMode: CpuUsageMode;
    deepMonitorEnabled: boolean;
    sampleIntervalMs: number;
    screenshotEnabled: boolean;
    screenshotIntervalMs: number;
}

export interface MonitorSettingsState {
    selectedSerial: string;
    setSelectedSerial: React.Dispatch<React.SetStateAction<string>>;
    selectedPackage: string;
    setSelectedPackage: React.Dispatch<React.SetStateAction<string>>;
    fpsMode: FpsMode;
    setFpsMode: React.Dispatch<React.SetStateAction<FpsMode>>;
    cpuMode: CpuUsageMode;
    setCpuMode: React.Dispatch<React.SetStateAction<CpuUsageMode>>;
    deepMonitorEnabled: boolean;
    setDeepMonitorEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    sampleIntervalMs: number;
    setSampleIntervalMs: React.Dispatch<React.SetStateAction<number>>;
    screenshotEnabled: boolean;
    setScreenshotEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    screenshotIntervalMs: number;
    setScreenshotIntervalMs: React.Dispatch<React.SetStateAction<number>>;
}

const MONITOR_SETTINGS_STORAGE_KEY = "ly-perf.monitor-settings";
const DEFAULT_FPS_MODE: FpsMode = "surfaceflinger";
const DEFAULT_CPU_MODE: CpuUsageMode = "traditional";
const DEFAULT_SAMPLE_INTERVAL_MS = 1000;
const DEFAULT_SCREENSHOT_INTERVAL_MS = 2000;

function parsePersistedMonitorSettings(
    raw: string | null
): PersistedMonitorSettings {
    if (!raw) {
        return {
            selectedSerial: "",
            selectedPackage: "",
            fpsMode: DEFAULT_FPS_MODE,
            cpuMode: DEFAULT_CPU_MODE,
            deepMonitorEnabled: false,
            sampleIntervalMs: DEFAULT_SAMPLE_INTERVAL_MS,
            screenshotEnabled: false,
            screenshotIntervalMs: DEFAULT_SCREENSHOT_INTERVAL_MS
        };
    }

    try {
        const parsed = JSON.parse(raw) as Partial<PersistedMonitorSettings>;

        return {
            selectedSerial:
                typeof parsed.selectedSerial === "string"
                    ? parsed.selectedSerial
                    : "",
            selectedPackage:
                typeof parsed.selectedPackage === "string"
                    ? parsed.selectedPackage
                    : "",
            fpsMode:
                parsed.fpsMode === "gfxinfo" ? "gfxinfo" : DEFAULT_FPS_MODE,
            cpuMode:
                parsed.cpuMode === "normalized"
                    ? "normalized"
                    : DEFAULT_CPU_MODE,
            deepMonitorEnabled: Boolean(parsed.deepMonitorEnabled),
            sampleIntervalMs:
                typeof parsed.sampleIntervalMs === "number" &&
                Number.isFinite(parsed.sampleIntervalMs)
                    ? parsed.sampleIntervalMs
                    : DEFAULT_SAMPLE_INTERVAL_MS,
            screenshotEnabled: Boolean(parsed.screenshotEnabled),
            screenshotIntervalMs:
                typeof parsed.screenshotIntervalMs === "number" &&
                Number.isFinite(parsed.screenshotIntervalMs)
                    ? parsed.screenshotIntervalMs
                    : DEFAULT_SCREENSHOT_INTERVAL_MS
        };
    } catch {
        return {
            selectedSerial: "",
            selectedPackage: "",
            fpsMode: DEFAULT_FPS_MODE,
            cpuMode: DEFAULT_CPU_MODE,
            deepMonitorEnabled: false,
            sampleIntervalMs: DEFAULT_SAMPLE_INTERVAL_MS,
            screenshotEnabled: false,
            screenshotIntervalMs: DEFAULT_SCREENSHOT_INTERVAL_MS
        };
    }
}

function loadPersistedMonitorSettings(): PersistedMonitorSettings {
    if (typeof window === "undefined") {
        return parsePersistedMonitorSettings(null);
    }

    return parsePersistedMonitorSettings(
        window.localStorage.getItem(MONITOR_SETTINGS_STORAGE_KEY)
    );
}

export function useMonitorSettings(): MonitorSettingsState {
    const [persistedSettings] = useState(loadPersistedMonitorSettings);
    const [selectedSerial, setSelectedSerial] = useState(
        persistedSettings.selectedSerial
    );
    const [selectedPackage, setSelectedPackage] = useState(
        persistedSettings.selectedPackage
    );
    const [fpsMode, setFpsMode] = useState<FpsMode>(persistedSettings.fpsMode);
    const [cpuMode, setCpuMode] = useState<CpuUsageMode>(
        persistedSettings.cpuMode
    );
    const [deepMonitorEnabled, setDeepMonitorEnabled] = useState(
        persistedSettings.deepMonitorEnabled
    );
    const [sampleIntervalMs, setSampleIntervalMs] = useState(
        persistedSettings.sampleIntervalMs
    );
    const [screenshotEnabled, setScreenshotEnabled] = useState(
        persistedSettings.screenshotEnabled
    );
    const [screenshotIntervalMs, setScreenshotIntervalMs] = useState(
        persistedSettings.screenshotIntervalMs
    );

    useEffect(() => {
        window.localStorage.setItem(
            MONITOR_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                selectedSerial,
                selectedPackage,
                fpsMode,
                cpuMode,
                deepMonitorEnabled,
                sampleIntervalMs,
                screenshotEnabled,
                screenshotIntervalMs
            } satisfies PersistedMonitorSettings)
        );
    }, [
        cpuMode,
        deepMonitorEnabled,
        fpsMode,
        sampleIntervalMs,
        screenshotEnabled,
        screenshotIntervalMs,
        selectedPackage,
        selectedSerial
    ]);

    return {
        selectedSerial,
        setSelectedSerial,
        selectedPackage,
        setSelectedPackage,
        fpsMode,
        setFpsMode,
        cpuMode,
        setCpuMode,
        deepMonitorEnabled,
        setDeepMonitorEnabled,
        sampleIntervalMs,
        setSampleIntervalMs,
        screenshotEnabled,
        setScreenshotEnabled,
        screenshotIntervalMs,
        setScreenshotIntervalMs
    };
}
