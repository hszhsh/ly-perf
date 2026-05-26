export type BuiltinMetricName =
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

export type MetricName = BuiltinMetricName;

export type DeepMonitorTransport = "tcp";
export type DeepMonitorSocketKind = "raw-tcp";
export type DeepMonitorDiscoveryTransport = "http";
export type DeepMonitorConnectionPhase =
    | "idle"
    | "waiting-for-client"
    | "connected"
    | "negotiating"
    | "ready"
    | "streaming"
    | "rejected"
    | "closed"
    | "error";
export type DeepMonitorValueType = "number" | "string" | "string-list";
export type DeepMonitorSampleValue = number | string | string[] | null;
export type DeepMonitorAggregationHint =
    | "last"
    | "sum"
    | "average"
    | "max"
    | "min";
export type DeepMonitorStatComputation = "min" | "max" | "average";
export type DeepMonitorStatScope = "visible-range" | "whole-session";
export type DeepMonitorStatSurface =
    | "reports-only"
    | "monitor-and-reports"
    | "monitor-only";

export interface DeepMonitorMetricDefinition {
    key: string;
    label: string;
    unit: string;
    color?: string;
    valueType: DeepMonitorValueType;
    aggregationHint?: DeepMonitorAggregationHint;
    description?: string;
}

export interface DeepMonitorChartStatsPolicy {
    enabled: boolean;
    computations: DeepMonitorStatComputation[];
    scope: DeepMonitorStatScope;
    surface: DeepMonitorStatSurface;
    metricKeys?: string[];
}

export interface DeepMonitorChartDefinition {
    id: string;
    title: string;
    metricKeys: string[];
    order?: number;
    description?: string;
    yAxisLabel?: string;
    yAxisUnit?: string;
    stats: DeepMonitorChartStatsPolicy;
}

export interface DeepMonitorSchemaRevision {
    revision: number;
    metrics: DeepMonitorMetricDefinition[];
    charts: DeepMonitorChartDefinition[];
    declaredAt: number;
    protocolVersion?: number;
}

export interface DeepMonitorSample {
    timestamp: number;
    receivedAt: number;
    schemaRevision: number;
    values: Record<string, DeepMonitorSampleValue>;
    sequence?: number;
}

export interface DeepMonitorSessionState {
    enabled: boolean;
    transport: DeepMonitorTransport;
    socketKind: DeepMonitorSocketKind;
    phase: DeepMonitorConnectionPhase;
    discovery?: {
        transport: DeepMonitorDiscoveryTransport;
        host: string;
        port: number;
        path: string;
    };
    port?: number;
    authToken?: string;
    protocolVersion?: number;
    activeSchemaRevision?: number;
    lastError?: string;
    connectedAt?: number;
    negotiatedAt?: number;
}

export interface DeepMonitorConfig {
    enabled: boolean;
    transport: DeepMonitorTransport;
    socketKind: DeepMonitorSocketKind;
    preferredPort?: number;
}

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

export type SessionTimelineEventType = "note" | "action" | "issue";

export interface SessionTimelineEvent {
    id: string;
    timestamp: number;
    type: SessionTimelineEventType;
    color: string;
    text: string;
    createdAt: number;
    updatedAt: number;
}

export interface SessionTimelineEventInput {
    timestamp: number;
    type: SessionTimelineEventType;
    color: string;
    text: string;
}

export interface SessionTimelineEventUpdate
    extends SessionTimelineEventInput {
    id: string;
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
    deepMonitor?: DeepMonitorConfig;
}

export interface MonitorState {
    running: boolean;
    sessionId?: string;
    config?: MonitorConfig;
    startedAt?: number;
    deepMonitor?: DeepMonitorSessionState;
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
    events: SessionTimelineEvent[];
    deepMonitor?: DeepMonitorSessionState;
    customMetricDefinitions?: DeepMonitorMetricDefinition[];
    customChartDefinitions?: DeepMonitorChartDefinition[];
    customSchemaHistory?: DeepMonitorSchemaRevision[];
    customSamples?: DeepMonitorSample[];
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
    onMonitorStateChange: (handler: (state: MonitorState) => void) => () => void;
    onMonitorCustomSchema: (
        handler: (schema: DeepMonitorSchemaRevision) => void
    ) => () => void;
    onMonitorCustomSamples: (
        handler: (samples: DeepMonitorSample[]) => void
    ) => () => void;
    onMonitorSample: (handler: (sample: MonitorSample) => void) => () => void;
    listSessions: () => Promise<SessionSummary[]>;
    getSession: (sessionId: string) => Promise<SessionDetail>;
    createSessionEvent: (
        sessionId: string,
        input: SessionTimelineEventInput
    ) => Promise<SessionDetail>;
    updateSessionEvent: (
        sessionId: string,
        input: SessionTimelineEventUpdate
    ) => Promise<SessionDetail>;
    deleteSessionEvent: (
        sessionId: string,
        eventId: string
    ) => Promise<SessionDetail>;
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
