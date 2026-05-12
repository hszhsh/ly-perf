import { useEffect, useMemo, useState } from "react";
import type {
    CpuUsageMode,
    ConnectedDevice,
    DeviceInfo,
    FpsDebugInfo,
    FpsMode,
    InstalledApp,
    MetricCapabilityReport,
    MetricDatum,
    MonitorConfig,
    MonitorSample,
    MonitorState,
    RuntimeInfo
} from "@shared/types";
import { MetricChart } from "@renderer/components/MetricChart";
import { SearchableSelect } from "@renderer/components/SearchableSelect";
import styles from "../styles/MonitorPage.module.css";

interface MonitorPageProps {
    onMonitorBusyChange?: (busy: boolean) => void;
}

interface PersistedMonitorSettings {
    selectedSerial: string;
    selectedPackage: string;
    fpsMode: FpsMode;
    cpuMode: CpuUsageMode;
    sampleIntervalMs: number;
    screenshotEnabled: boolean;
    screenshotIntervalMs: number;
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

function formatMetricValue(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMetric(metric: MetricDatum | undefined): string {
    if (!metric?.available || metric.value === null) {
        return "N/A";
    }

    return `${formatMetricValue(metric.value)} ${metric.unit}`;
}

function formatTraffic(metric: MetricDatum | undefined): string {
    if (!metric?.available || metric.value === null) {
        return "N/A";
    }

    if (metric.unit === "MB" && metric.value >= 1024) {
        return `${formatMetricValue(metric.value / 1024)} GB`;
    }

    return `${formatMetricValue(metric.value)} ${metric.unit}`;
}

export function MonitorPage({ onMonitorBusyChange }: MonitorPageProps) {
    const [persistedSettings] = useState(loadPersistedMonitorSettings);
    const chartSyncGroup = "monitor-metric-charts";
    const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
    const [devices, setDevices] = useState<ConnectedDevice[]>([]);
    const [selectedSerial, setSelectedSerial] = useState(
        persistedSettings.selectedSerial
    );
    const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);

    const [apps, setApps] = useState<InstalledApp[]>([]);
    const [selectedPackage, setSelectedPackage] = useState(
        persistedSettings.selectedPackage
    );
    const [loadingApps, setLoadingApps] = useState(false);

    const [monitorState, setMonitorState] = useState<MonitorState>({
        running: false
    });
    const [samples, setSamples] = useState<MonitorSample[]>([]);
    const [fpsDebug, setFpsDebug] = useState<FpsDebugInfo | null>(null);
    const [capabilityReport, setCapabilityReport] =
        useState<MetricCapabilityReport | null>(null);

    const [fpsMode, setFpsMode] = useState<FpsMode>(persistedSettings.fpsMode);
    const [cpuMode, setCpuMode] = useState<CpuUsageMode>(
        persistedSettings.cpuMode
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
    const [latestScreenshotUrl, setLatestScreenshotUrl] = useState("");
    const [isScreenshotLoading, setIsScreenshotLoading] = useState(false);
    const [isStarting, setIsStarting] = useState(false);

    const [errorMessage, setErrorMessage] = useState("");
    const activeCpuMode = monitorState.running
        ? (monitorState.config?.cpuMode ?? cpuMode)
        : cpuMode;
    const latestMetrics = samples[samples.length - 1]?.metrics;

    useEffect(() => {
        onMonitorBusyChange?.(isStarting || monitorState.running);
    }, [isStarting, monitorState.running, onMonitorBusyChange]);

    useEffect(() => {
        window.localStorage.setItem(
            MONITOR_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                selectedSerial,
                selectedPackage,
                fpsMode,
                cpuMode,
                sampleIntervalMs,
                screenshotEnabled,
                screenshotIntervalMs
            } satisfies PersistedMonitorSettings)
        );
    }, [
        cpuMode,
        fpsMode,
        sampleIntervalMs,
        screenshotEnabled,
        screenshotIntervalMs,
        selectedPackage,
        selectedSerial
    ]);

    const latestScreenshot = useMemo(() => {
        for (let i = samples.length - 1; i >= 0; i -= 1) {
            const sample = samples[i];
            if (sample?.screenshotPath) {
                return sample.screenshotPath;
            }
        }

        return undefined;
    }, [samples]);

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

    const appOptions = useMemo(
        () =>
            apps.map((app) => ({
                value: app.packageName,
                label: `${app.packageName}${app.isSystem ? " [system]" : ""}`,
                searchText: app.packageName
            })),
        [apps]
    );

    async function refreshDevices(): Promise<void> {
        const list = await window.lyPerf.listDevices();
        setDevices(list);

        setSelectedSerial((current) => {
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

            setSelectedPackage((current) => {
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
                setSelectedSerial(state.config.serial);
            }
            if (state.config?.packageName) {
                setSelectedPackage(state.config.packageName);
            }
            if (state.config?.fpsMode) {
                setFpsMode(state.config.fpsMode);
            }
            if (state.config?.cpuMode) {
                setCpuMode(state.config.cpuMode);
            }
            if (typeof state.config?.sampleIntervalMs === "number") {
                setSampleIntervalMs(state.config.sampleIntervalMs);
            }
            if (typeof state.config?.screenshotEnabled === "boolean") {
                setScreenshotEnabled(state.config.screenshotEnabled);
            }
            if (typeof state.config?.screenshotIntervalMs === "number") {
                setScreenshotIntervalMs(state.config.screenshotIntervalMs);
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
        if (!selectedSerial) {
            setDeviceInfo(null);
            setApps([]);
            setSelectedPackage("");
            setCapabilityReport(null);
            setFpsDebug(null);
            return;
        }

        void (async () => {
            const [info] = await Promise.all([
                window.lyPerf.getDeviceInfo(selectedSerial),
                refreshApps(selectedSerial)
            ]);

            setDeviceInfo(info);
        })();
    }, [selectedSerial]);

    async function handleStart(): Promise<void> {
        if (isStarting) {
            return;
        }

        if (!selectedSerial) {
            setErrorMessage(
                "未检测到可用设备，请先连接安卓设备。\n可执行 adb devices 确认连接。"
            );
            return;
        }

        if (!selectedPackage) {
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
            serial: selectedSerial,
            packageName: selectedPackage,
            fpsMode,
            cpuMode,
            sampleIntervalMs,
            screenshotEnabled,
            screenshotIntervalMs
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

    return (
        <section className={styles.page}>
            <aside className={styles.sidebar}>
                <div className={styles.section}>
                    <h3>运行时信息</h3>
                    <div className={styles.kvList}>
                        <div>
                            <span>版本</span>
                            <strong>{runtimeInfo?.version ?? "-"}</strong>
                        </div>
                        <div>
                            <span>ADB 路径</span>
                            <strong className={styles.path}>
                                {runtimeInfo?.adbPath ?? "-"}
                            </strong>
                        </div>
                    </div>
                </div>

                <div className={styles.section}>
                    <h3>设备选择</h3>
                    <div className={styles.row}>
                        <select
                            className={`${styles.select} ${styles.appSelector}`}
                            value={selectedSerial}
                            onChange={(event) =>
                                setSelectedSerial(event.target.value)
                            }
                        >
                            {devices.length === 0 ? (
                                <option value="">未检测到设备</option>
                            ) : null}
                            {devices.map((device) => (
                                <option
                                    key={device.serial}
                                    value={device.serial}
                                >
                                    {device.serial}{" "}
                                    {device.model ? `(${device.model})` : ""}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            className={styles.selectorAction}
                            onClick={() => void refreshDevices()}
                        >
                            刷新
                        </button>
                    </div>

                    {deviceInfo ? (
                        <table className={styles.infoTable}>
                            <tbody>
                                <tr>
                                    <td>品牌</td>
                                    <td>{deviceInfo.brand}</td>
                                </tr>
                                <tr>
                                    <td>型号</td>
                                    <td>{deviceInfo.model}</td>
                                </tr>
                                <tr>
                                    <td>Android</td>
                                    <td>
                                        {deviceInfo.androidVersion} (SDK{" "}
                                        {deviceInfo.sdkInt})
                                    </td>
                                </tr>
                                <tr>
                                    <td>内存</td>
                                    <td>{deviceInfo.totalMemory}</td>
                                </tr>
                                <tr>
                                    <td>OpenGL</td>
                                    <td>{deviceInfo.openGlVersion}</td>
                                </tr>
                                <tr>
                                    <td>Vulkan</td>
                                    <td>{deviceInfo.vulkanVersion}</td>
                                </tr>
                                <tr>
                                    <td>CPU</td>
                                    <td>{deviceInfo.cpuModel}</td>
                                </tr>
                                <tr>
                                    <td>GPU</td>
                                    <td>{deviceInfo.gpuModel}</td>
                                </tr>
                                <tr>
                                    <td>分辨率</td>
                                    <td>{deviceInfo.resolution}</td>
                                </tr>
                            </tbody>
                        </table>
                    ) : (
                        <p className={styles.placeholder}>
                            请选择设备查看基础信息。
                        </p>
                    )}
                </div>

                <div className={styles.section}>
                    <h3>目标应用</h3>
                    <div className={styles.row}>
                        <SearchableSelect
                            className={styles.appSelector}
                            value={selectedPackage}
                            options={appOptions}
                            disabled={!selectedSerial || loadingApps}
                            placeholder={
                                selectedSerial
                                    ? "请选择应用包名"
                                    : "请先选择设备"
                            }
                            searchPlaceholder="输入包名关键字过滤"
                            emptyText={
                                !selectedSerial
                                    ? "请先选择设备"
                                    : loadingApps
                                      ? "应用加载中..."
                                      : "无可选应用"
                            }
                            onChange={setSelectedPackage}
                        />
                        <button
                            type="button"
                            className={styles.selectorAction}
                            disabled={!selectedSerial || loadingApps}
                            onClick={() => void refreshApps(selectedSerial)}
                        >
                            {loadingApps ? "加载中" : "刷新"}
                        </button>
                    </div>

                    <p className={styles.tip}>
                        若应用未成功自动拉起，请手动打开应用后继续监控。
                    </p>
                </div>

                <div className={styles.section}>
                    <h3>监控参数</h3>
                    <div className={styles.formGrid}>
                        <label>
                            FPS 统计方式
                            <select
                                className={styles.select}
                                value={fpsMode}
                                onChange={(event) =>
                                    setFpsMode(event.target.value as FpsMode)
                                }
                            >
                                <option value="surfaceflinger">
                                    SurfaceFlinger（默认）
                                </option>
                                <option value="gfxinfo">
                                    gfxinfo（应用级）
                                </option>
                            </select>
                        </label>

                        <label>
                            CPU 统计方式
                            <select
                                className={styles.select}
                                value={cpuMode}
                                onChange={(event) =>
                                    setCpuMode(
                                        event.target.value as CpuUsageMode
                                    )
                                }
                            >
                                <option value="traditional">
                                    CPU Usage（传统）
                                </option>
                                <option value="normalized">
                                    CPU Usage (Normalized)（规范化）
                                </option>
                            </select>
                        </label>

                        <label>
                            采样间隔(ms)
                            <input
                                className={styles.input}
                                type="number"
                                min={500}
                                step={100}
                                value={sampleIntervalMs}
                                onChange={(event) =>
                                    setSampleIntervalMs(
                                        Number(event.target.value)
                                    )
                                }
                            />
                        </label>

                        <label className={styles.checkboxLabel}>
                            <input
                                type="checkbox"
                                checked={screenshotEnabled}
                                onChange={(event) =>
                                    setScreenshotEnabled(event.target.checked)
                                }
                            />
                            监控期间抓取截图
                        </label>

                        <label>
                            截图间隔(ms)
                            <input
                                className={styles.input}
                                type="number"
                                min={500}
                                step={100}
                                disabled={!screenshotEnabled}
                                value={screenshotIntervalMs}
                                onChange={(event) =>
                                    setScreenshotIntervalMs(
                                        Number(event.target.value)
                                    )
                                }
                            />
                        </label>
                    </div>

                    <p className={styles.tip}>
                        SurfaceFlinger 默认更稳健；CPU
                        默认使用传统口径，规范化口径会额外乘以当前总频率/最大总频率。
                    </p>

                    <div className={styles.row}>
                        <button
                            type="button"
                            disabled={monitorState.running || isStarting}
                            onClick={() => void handleStart()}
                        >
                            开始监控
                        </button>
                        <button
                            type="button"
                            disabled={!monitorState.running}
                            onClick={() => void handleStop()}
                        >
                            停止监控
                        </button>
                    </div>

                    <p className={styles.status}>
                        {isStarting
                            ? "状态: 监控启动中"
                            : monitorState.running
                              ? "状态: 监控中"
                              : "状态: 空闲"}
                    </p>

                    {errorMessage ? (
                        <pre className={styles.error}>{errorMessage}</pre>
                    ) : null}
                </div>

                <div className={styles.section}>
                    <h3>FPS 调试</h3>
                    {fpsDebug ? (
                        <>
                            <div className={styles.debugGrid}>
                                <div>
                                    <span>请求方式</span>
                                    <strong>
                                        {fpsDebug.requestedMode ===
                                        "surfaceflinger"
                                            ? "SurfaceFlinger"
                                            : "gfxinfo"}
                                    </strong>
                                </div>
                                <div>
                                    <span>实际来源</span>
                                    <strong>
                                        {fpsDebug.activeSource ===
                                        "surfaceflinger"
                                            ? "SurfaceFlinger"
                                            : fpsDebug.activeSource ===
                                                "gfxinfo"
                                              ? "gfxinfo"
                                              : "none"}
                                    </strong>
                                </div>
                                <div>
                                    <span>回退状态</span>
                                    <strong>
                                        {fpsDebug.fallbackUsed
                                            ? "已回退"
                                            : "未回退"}
                                    </strong>
                                </div>
                                <div>
                                    <span>当前图层</span>
                                    <strong className={styles.path}>
                                        {fpsDebug.selectedLayer ?? "N/A"}
                                    </strong>
                                </div>
                                <div>
                                    <span>取值模式</span>
                                    <strong>
                                        {fpsDebug.surfaceFlingerValueMode ??
                                            "N/A"}
                                    </strong>
                                </div>
                                <div>
                                    <span>原始样本数</span>
                                    <strong>
                                        {fpsDebug.surfaceFlingerSampleCount ??
                                            "N/A"}
                                    </strong>
                                </div>
                                <div>
                                    <span>时间轴长度</span>
                                    <strong>
                                        {fpsDebug.surfaceFlingerTimelineCount ??
                                            "N/A"}
                                    </strong>
                                </div>
                                <div>
                                    <span>时间轴状态</span>
                                    <strong>
                                        {fpsDebug.surfaceFlingerNeedsClear
                                            ? "待 clear"
                                            : fpsDebug.surfaceFlingerTimelinePrimed
                                              ? "已预热"
                                              : "未预热"}
                                    </strong>
                                </div>
                            </div>

                            {fpsDebug.layerSwitchReason ? (
                                <p className={styles.debugNote}>
                                    {fpsDebug.layerSwitchReason}
                                </p>
                            ) : null}
                            {fpsDebug.fallbackReason ? (
                                <p className={styles.debugWarn}>
                                    {fpsDebug.fallbackReason}
                                </p>
                            ) : null}

                            <div className={styles.candidateList}>
                                {fpsDebug.candidates.length === 0 ? (
                                    <p className={styles.placeholder}>
                                        当前无可用 SurfaceFlinger 图层候选。
                                    </p>
                                ) : (
                                    fpsDebug.candidates.map((candidate) => (
                                        <div
                                            className={styles.candidateItem}
                                            key={candidate.layer}
                                        >
                                            <div
                                                className={
                                                    styles.candidateTitle
                                                }
                                            >
                                                <span className={styles.path}>
                                                    {candidate.layer}
                                                </span>
                                            </div>
                                            <div
                                                className={styles.candidateMeta}
                                            >
                                                <span>
                                                    score={candidate.score}
                                                </span>
                                                <span>
                                                    {candidate.packageMatch
                                                        ? "包名命中"
                                                        : "包名未命中"}
                                                </span>
                                                <span>
                                                    {candidate.tried
                                                        ? "已尝试"
                                                        : "未尝试"}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </>
                    ) : (
                        <p className={styles.placeholder}>
                            开始监控后可查看 FPS 图层匹配、切换与回退详情。
                        </p>
                    )}
                </div>

                <div className={styles.section}>
                    <h3>能力报告</h3>
                    {capabilityReport ? (
                        <>
                            <p className={styles.debugNote}>
                                更新时间:{" "}
                                {new Date(
                                    capabilityReport.updatedAt
                                ).toLocaleString()}
                            </p>

                            <div className={styles.capabilityBlock}>
                                <h4>GPU 适配链</h4>
                                <p className={styles.debugNote}>
                                    vendor={capabilityReport.gpu.vendor} |
                                    selected=
                                    {capabilityReport.gpu.selectedAdapterKey ??
                                        "none"}
                                </p>
                                {capabilityReport.gpu.adapters.map(
                                    (adapter) => (
                                        <div
                                            className={styles.adapterRow}
                                            key={adapter.key}
                                        >
                                            <span
                                                className={
                                                    adapter.selected
                                                        ? styles.adapterSelected
                                                        : styles.adapterName
                                                }
                                            >
                                                {adapter.label}
                                            </span>
                                            <span>
                                                {adapter.supported
                                                    ? `${adapter.value ?? "N/A"}${adapter.unit}`
                                                    : `N/A(${adapter.reason ?? "unsupported"})`}
                                            </span>
                                        </div>
                                    )
                                )}
                            </div>

                            <div className={styles.capabilityBlock}>
                                <h4>功耗适配链</h4>
                                <p className={styles.debugNote}>
                                    vendor={capabilityReport.power.vendor} |
                                    selected=
                                    {capabilityReport.power
                                        .selectedAdapterKey ?? "none"}
                                </p>
                                {capabilityReport.power.adapters.map(
                                    (adapter) => (
                                        <div
                                            className={styles.adapterRow}
                                            key={adapter.key}
                                        >
                                            <span
                                                className={
                                                    adapter.selected
                                                        ? styles.adapterSelected
                                                        : styles.adapterName
                                                }
                                            >
                                                {adapter.label}
                                            </span>
                                            <span>
                                                {adapter.supported
                                                    ? `${adapter.value ?? "N/A"}${adapter.unit}`
                                                    : `N/A(${adapter.reason ?? "unsupported"})`}
                                            </span>
                                        </div>
                                    )
                                )}
                            </div>
                        </>
                    ) : (
                        <p className={styles.placeholder}>
                            开始监控后可查看厂商能力探测与适配链命中结果。
                        </p>
                    )}
                </div>
            </aside>

            <div className={styles.content}>
                <section className={styles.networkSummary}>
                    <div className={styles.summaryCard}>
                        <span>下行速率</span>
                        <strong>
                            {formatMetric(latestMetrics?.networkRx)}
                        </strong>
                        <small>当前采样窗口下载速率</small>
                    </div>
                    <div className={styles.summaryCard}>
                        <span>上行速率</span>
                        <strong>
                            {formatMetric(latestMetrics?.networkTx)}
                        </strong>
                        <small>当前采样窗口上传速率</small>
                    </div>
                    <div className={styles.summaryCard}>
                        <span>会话总流量</span>
                        <strong>
                            {formatTraffic(latestMetrics?.networkTotal)}
                        </strong>
                        <small>从本次监控启动开始累计</small>
                    </div>
                </section>

                <div className={styles.charts}>
                    <MetricChart
                        title="帧率（FPS）"
                        samples={samples}
                        syncGroup={chartSyncGroup}
                        series={[
                            { name: "FPS", key: "fps", color: "#e24a6e" },
                            { name: "Jank", key: "jank", color: "#f4b860" },
                            {
                                name: "Big Jank",
                                key: "bigJank",
                                color: "#ff7a59"
                            }
                        ]}
                    />

                    <MetricChart
                        title="负载（App CPU / Total CPU / GPU）"
                        samples={samples}
                        syncGroup={chartSyncGroup}
                        series={[
                            {
                                name:
                                    activeCpuMode === "normalized"
                                        ? "App CPU Norm.(%)"
                                        : "App CPU(%)",
                                key: "cpu",
                                color: "#5ca6ff"
                            },
                            {
                                name:
                                    activeCpuMode === "normalized"
                                        ? "Total CPU Norm.(%)"
                                        : "Total CPU(%)",
                                key: "cpuTotal",
                                color: "#59d6d6"
                            },
                            { name: "GPU(%)", key: "gpu", color: "#7bd389" }
                        ]}
                    />

                    <MetricChart
                        title="内存细分（MB）"
                        samples={samples}
                        syncGroup={chartSyncGroup}
                        series={[
                            {
                                name: "PSS Total",
                                key: "memory",
                                color: "#f4b860"
                            },
                            {
                                name: "Graphics",
                                key: "memoryGraphics",
                                color: "#4fc3f7"
                            },
                            {
                                name: "Native Heap",
                                key: "memoryNativeHeap",
                                color: "#81c784"
                            },
                            {
                                name: "Private Other",
                                key: "memoryPrivateOther",
                                color: "#ff8a65"
                            }
                        ]}
                    />

                    <MetricChart
                        title="资源吞吐（网络上下行速率 / 磁盘）"
                        samples={samples}
                        syncGroup={chartSyncGroup}
                        series={[
                            {
                                name: "下行 KB/s",
                                key: "networkRx",
                                color: "#4dd0e1"
                            },
                            {
                                name: "上行 KB/s",
                                key: "networkTx",
                                color: "#26a69a"
                            },
                            {
                                name: "Disk Read",
                                key: "diskRead",
                                color: "#ab47bc"
                            },
                            {
                                name: "Disk Write",
                                key: "diskWrite",
                                color: "#7e57c2"
                            }
                        ]}
                    />

                    <MetricChart
                        title="温度与功耗"
                        samples={samples}
                        syncGroup={chartSyncGroup}
                        series={[
                            {
                                name: "Temperature(°C)",
                                key: "temperature",
                                color: "#ff7043"
                            },
                            {
                                name: "Power(mA)",
                                key: "power",
                                color: "#ffee58"
                            }
                        ]}
                    />
                </div>

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
            </div>
        </section>
    );
}
