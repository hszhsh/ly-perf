export type MetricName =
    | "fps"
    | "jank"
    | "bigJank"
    | "cpu"
    | "cpuTotal"
    | "memory"
    | "memoryGraphics"
    | "memoryNativeHeap"
    | "memoryPrivateOther"
    | "networkRx"
    | "networkTx"
    | "networkTotal"
    | "diskRead"
    | "diskWrite"
    | "gpu"
    | "power"
    | "temperature";

export type FpsMode = "surfaceflinger" | "gfxinfo";
export type CpuUsageMode = "traditional" | "normalized";
export type FpsActiveSource = "surfaceflinger" | "gfxinfo" | "none";
export type SurfaceFlingerValueMode =
    | "warmup"
    | "timeline"
    | "snapshot"
    | "unavailable";

export interface FpsLayerCandidate {
    layer: string;
    score: number;
    packageMatch: boolean;
    tried: boolean;
}

export interface FpsDebugInfo {
    requestedMode: FpsMode;
    activeSource: FpsActiveSource;
    fallbackUsed: boolean;
    fallbackReason?: string;
    selectedLayer: string | null;
    layerSwitchReason?: string;
    candidates: FpsLayerCandidate[];
    surfaceFlingerValueMode?: SurfaceFlingerValueMode;
    surfaceFlingerSampleCount?: number;
    surfaceFlingerTimelineCount?: number;
    surfaceFlingerTimelinePrimed?: boolean;
    surfaceFlingerNeedsClear?: boolean;
}

export interface CapabilityAdapter {
    key: string;
    label: string;
    vendor: string;
    source: string;
    unit: string;
    supported: boolean;
    selected: boolean;
    value: number | null;
    reason?: string;
}

export interface CapabilityGroup {
    vendor: string;
    selectedAdapterKey: string | null;
    adapters: CapabilityAdapter[];
}

export interface MetricCapabilityReport {
    serial: string;
    packageName: string;
    updatedAt: number;
    fps: FpsDebugInfo;
    gpu: CapabilityGroup;
    power: CapabilityGroup;
}

export interface MetricDatum {
    value: number | null;
    unit: string;
    available: boolean;
    reason?: string;
    source?: string;
}

export type MetricSnapshot = Record<MetricName, MetricDatum>;

export interface MonitorSample {
    timestamp: number;
    metrics: MetricSnapshot;
    screenshotPath?: string;
    fpsDebug?: FpsDebugInfo;
    capabilityReport?: MetricCapabilityReport;
}

export interface ConnectedDevice {
    serial: string;
    status: string;
    model?: string;
}

export interface DeviceInfo {
    serial: string;
    brand: string;
    manufacturer: string;
    model: string;
    androidVersion: string;
    sdkInt: string;
    totalMemory: string;
    openGlVersion: string;
    vulkanVersion: string;
    cpuModel: string;
    cpuAbi: string;
    gpuModel: string;
    resolution: string;
}

export interface InstalledApp {
    packageName: string;
    isSystem: boolean;
}

export interface MonitorConfig {
    serial: string;
    packageName: string;
    fpsMode: FpsMode;
    cpuMode?: CpuUsageMode;
    sampleIntervalMs: number;
    screenshotEnabled: boolean;
    screenshotIntervalMs: number;
}

export interface MonitorState {
    running: boolean;
    sessionId?: string;
    config?: MonitorConfig;
    startedAt?: number;
}

export type SessionPersistenceState = "finalized" | "recovered";

export interface SessionSummary {
    id: string;
    serial: string;
    packageName: string;
    displayName: string;
    startedAt: number;
    endedAt: number;
    sampleCount: number;
    persistenceState: SessionPersistenceState;
}

export interface SessionDetail extends SessionSummary {
    config: MonitorConfig;
    deviceInfo: DeviceInfo;
    samples: MonitorSample[];
}

export interface ExportResult {
    format: "html" | "xlsx";
    outputPath: string;
}

export interface RuntimeInfo {
    adbPath: string;
    dataDir: string;
    version: string;
}

export interface LyPerfApi {
    getRuntimeInfo: () => Promise<RuntimeInfo>;
    listDevices: () => Promise<ConnectedDevice[]>;
    getDeviceInfo: (serial: string) => Promise<DeviceInfo>;
    listInstalledApps: (
        serial: string,
        keyword?: string
    ) => Promise<InstalledApp[]>;
    readScreenshotDataUrl: (filePath: string) => Promise<string | null>;
    startMonitor: (config: MonitorConfig) => Promise<MonitorState>;
    stopMonitor: () => Promise<MonitorState>;
    getMonitorState: () => Promise<MonitorState>;
    getMonitorCapabilityReport: () => Promise<MetricCapabilityReport | null>;
    onMonitorSample: (handler: (sample: MonitorSample) => void) => () => void;
    listSessions: () => Promise<SessionSummary[]>;
    getSession: (sessionId: string) => Promise<SessionDetail>;
    renameSession: (
        sessionId: string,
        displayName: string
    ) => Promise<SessionDetail>;
    deleteSession: (sessionId: string) => Promise<void>;
    exportSession: (
        sessionId: string,
        format: "html" | "xlsx"
    ) => Promise<ExportResult>;
}
