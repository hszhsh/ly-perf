import type {
    ConnectedDevice,
    CpuUsageMode,
    DeviceInfo,
    FpsDebugInfo,
    FpsMode,
    MetricCapabilityReport,
    RuntimeInfo
} from "@shared/types";
import {
    SearchableSelect,
    type SearchableSelectOption
} from "@renderer/components/SearchableSelect";
import styles from "@renderer/styles/MonitorPage.module.css";

interface MonitorSidebarProps {
    runtimeInfo: RuntimeInfo | null;
    devices: ConnectedDevice[];
    deviceInfo: DeviceInfo | null;
    selectedSerial: string;
    onSelectedSerialChange: (value: string) => void;
    onRefreshDevices: () => void;
    appOptions: SearchableSelectOption[];
    selectedPackage: string;
    onSelectedPackageChange: (value: string) => void;
    loadingApps: boolean;
    onRefreshApps: () => void;
    fpsMode: FpsMode;
    onFpsModeChange: (value: FpsMode) => void;
    cpuMode: CpuUsageMode;
    onCpuModeChange: (value: CpuUsageMode) => void;
    sampleIntervalMs: number;
    onSampleIntervalChange: (value: number) => void;
    screenshotEnabled: boolean;
    onScreenshotEnabledChange: (value: boolean) => void;
    screenshotIntervalMs: number;
    onScreenshotIntervalChange: (value: number) => void;
    running: boolean;
    isStarting: boolean;
    errorMessage: string;
    onStart: () => void;
    onStop: () => void;
    fpsDebug: FpsDebugInfo | null;
    capabilityReport: MetricCapabilityReport | null;
}

export function MonitorSidebar({
    runtimeInfo,
    devices,
    deviceInfo,
    selectedSerial,
    onSelectedSerialChange,
    onRefreshDevices,
    appOptions,
    selectedPackage,
    onSelectedPackageChange,
    loadingApps,
    onRefreshApps,
    fpsMode,
    onFpsModeChange,
    cpuMode,
    onCpuModeChange,
    sampleIntervalMs,
    onSampleIntervalChange,
    screenshotEnabled,
    onScreenshotEnabledChange,
    screenshotIntervalMs,
    onScreenshotIntervalChange,
    running,
    isStarting,
    errorMessage,
    onStart,
    onStop,
    fpsDebug,
    capabilityReport
}: MonitorSidebarProps) {
    return (
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
                            onSelectedSerialChange(event.target.value)
                        }
                    >
                        {devices.length === 0 ? (
                            <option value="">未检测到设备</option>
                        ) : null}
                        {devices.map((device) => (
                            <option key={device.serial} value={device.serial}>
                                {device.serial}{" "}
                                {device.model ? `(${device.model})` : ""}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className={styles.selectorAction}
                        onClick={onRefreshDevices}
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
                            selectedSerial ? "请选择应用包名" : "请先选择设备"
                        }
                        searchPlaceholder="输入包名关键字过滤"
                        emptyText={
                            !selectedSerial
                                ? "请先选择设备"
                                : loadingApps
                                  ? "应用加载中..."
                                  : "无可选应用"
                        }
                        onChange={onSelectedPackageChange}
                    />
                    <button
                        type="button"
                        className={styles.selectorAction}
                        disabled={!selectedSerial || loadingApps}
                        onClick={onRefreshApps}
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
                                onFpsModeChange(event.target.value as FpsMode)
                            }
                        >
                            <option value="surfaceflinger">
                                SurfaceFlinger（默认）
                            </option>
                            <option value="gfxinfo">gfxinfo（应用级）</option>
                        </select>
                    </label>

                    <label>
                        CPU 统计方式
                        <select
                            className={styles.select}
                            value={cpuMode}
                            onChange={(event) =>
                                onCpuModeChange(
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
                                onSampleIntervalChange(
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
                                onScreenshotEnabledChange(event.target.checked)
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
                                onScreenshotIntervalChange(
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
                        disabled={running || isStarting}
                        onClick={onStart}
                    >
                        开始监控
                    </button>
                    <button type="button" disabled={!running} onClick={onStop}>
                        停止监控
                    </button>
                </div>

                <p className={styles.status}>
                    {isStarting
                        ? "状态: 监控启动中"
                        : running
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
                                    {fpsDebug.requestedMode === "surfaceflinger"
                                        ? "SurfaceFlinger"
                                        : "gfxinfo"}
                                </strong>
                            </div>
                            <div>
                                <span>实际来源</span>
                                <strong>
                                    {fpsDebug.activeSource === "surfaceflinger"
                                        ? "SurfaceFlinger"
                                        : fpsDebug.activeSource === "gfxinfo"
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
                                    {fpsDebug.surfaceFlingerValueMode ?? "N/A"}
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
                                        <div className={styles.candidateTitle}>
                                            <span className={styles.path}>
                                                {candidate.layer}
                                            </span>
                                        </div>
                                        <div className={styles.candidateMeta}>
                                            <span>score={candidate.score}</span>
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
                                vendor={capabilityReport.gpu.vendor} | selected=
                                {capabilityReport.gpu.selectedAdapterKey ??
                                    "none"}
                            </p>
                            {capabilityReport.gpu.adapters.map((adapter) => (
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
                            ))}
                        </div>

                        <div className={styles.capabilityBlock}>
                            <h4>功耗适配链</h4>
                            <p className={styles.debugNote}>
                                vendor={capabilityReport.power.vendor} |
                                selected=
                                {capabilityReport.power.selectedAdapterKey ??
                                    "none"}
                            </p>
                            {capabilityReport.power.adapters.map((adapter) => (
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
                            ))}
                        </div>
                    </>
                ) : (
                    <p className={styles.placeholder}>
                        开始监控后可查看厂商能力探测与适配链命中结果。
                    </p>
                )}
            </div>
        </aside>
    );
}
