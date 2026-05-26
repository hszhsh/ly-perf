import type {
    DeepMonitorConnectionPhase,
    DeepMonitorChartDefinition,
    DeepMonitorMetricDefinition,
    DeepMonitorSampleValue,
    DeepMonitorSocketKind,
    DeepMonitorTransport
} from "./types";

export const DEEP_MONITOR_PROTOCOL_VERSION = 1 as const;
export const DEEP_MONITOR_SUPPORTED_PROTOCOL_VERSIONS = [
    DEEP_MONITOR_PROTOCOL_VERSION
] as const;
export const DEEP_MONITOR_FRAME_HEADER_SIZE = 4 as const;
export const DEEP_MONITOR_DISCOVERY_VERSION = 1 as const;
export const DEEP_MONITOR_DISCOVERY_KIND =
    "ly-perf.deep-monitor.discovery" as const;
export const DEEP_MONITOR_DISCOVERY_PORT = 27183 as const;
export const DEEP_MONITOR_DISCOVERY_PATH =
    "/deep-monitor/discovery" as const;
export const DEEP_MONITOR_DISCOVERY_CONTENT_TYPE =
    "application/json; charset=utf-8" as const;

export const DEEP_MONITOR_PROTOCOL_ERROR_CODES = {
    sessionBusy: "SESSION_BUSY",
    invalidFrame: "INVALID_FRAME",
    invalidJson: "INVALID_JSON",
    unsupportedMessageType: "UNSUPPORTED_MESSAGE_TYPE",
    helloRequired: "HELLO_REQUIRED",
    invalidHello: "INVALID_HELLO",
    unsupportedProtocolVersion: "UNSUPPORTED_PROTOCOL_VERSION",
    authTokenMismatch: "AUTH_TOKEN_MISMATCH",
    invalidSchema: "INVALID_SCHEMA",
    schemaRevisionMismatch: "SCHEMA_REVISION_MISMATCH",
    invalidSampleBatch: "INVALID_SAMPLE_BATCH",
    internalError: "INTERNAL_ERROR"
} as const;

export type DeepMonitorProtocolErrorCode =
    (typeof DEEP_MONITOR_PROTOCOL_ERROR_CODES)[keyof typeof DEEP_MONITOR_PROTOCOL_ERROR_CODES];

export const DEEP_MONITOR_RESERVED_FIELDS = {
    allMessages: ["requestId", "extensions", "reserved"] as const,
    hello: ["clientInfo", "capabilities"] as const,
    schemaDeclare: ["schemaId", "replaceActiveSchema"] as const,
    sampleBatch: ["batchId", "compression"] as const,
    heartbeat: ["clientTimestamp"] as const,
    helloAck: ["serverTime", "supportedProtocolVersions"] as const,
    schemaAck: ["warnings"] as const,
    sampleAck: ["lastAcceptedSequence", "warnings"] as const,
    heartbeatAck: ["serverTime"] as const,
    error: ["details", "retryable"] as const
} as const;

export const DEEP_MONITOR_PROTOCOL_COMPATIBILITY = {
    additiveChangesMustRemainOptional: true,
    receiversMustIgnoreUnknownOptionalFields: true,
    envelopeBreakingChangesRequireProtocolVersionBump: true,
    schemaShapeBreakingChangesRequireSchemaRevisionBump: true
} as const;

export interface DeepMonitorDiscoveryDocument {
    kind: typeof DEEP_MONITOR_DISCOVERY_KIND;
    discoveryVersion: number;
    serverTime: number;
    stream: {
        host: "127.0.0.1";
        port: number;
        transport: DeepMonitorTransport;
        socketKind: DeepMonitorSocketKind;
        protocolVersion: number;
        sessionToken: string;
    };
    session: {
        phase: DeepMonitorConnectionPhase;
        activeSchemaRevision: number | null;
        connectedAt?: number;
        negotiatedAt?: number;
    };
}

export interface DeepMonitorProtocolEnvelope {
    requestId?: string;
    extensions?: Record<string, unknown>;
    reserved?: Record<string, unknown>;
}

export interface DeepMonitorHelloMessage
    extends DeepMonitorProtocolEnvelope {
    type: "hello";
    protocolVersion: number;
    sessionToken: string;
    clientInfo?: Record<string, unknown>;
    capabilities?: string[];
}

export interface DeepMonitorSchemaDeclareMessage
    extends DeepMonitorProtocolEnvelope {
    type: "schemaDeclare";
    schemaRevision: number;
    metrics: DeepMonitorMetricDefinition[];
    charts: DeepMonitorChartDefinition[];
    schemaId?: string;
    replaceActiveSchema?: boolean;
}

export interface DeepMonitorSampleBatchItem {
    timestamp: number;
    values: Record<string, DeepMonitorSampleValue>;
    sequence?: number;
}

export interface DeepMonitorSampleBatchMessage
    extends DeepMonitorProtocolEnvelope {
    type: "sampleBatch";
    schemaRevision: number;
    samples: DeepMonitorSampleBatchItem[];
    batchId?: string;
    compression?: "none";
}

export interface DeepMonitorHeartbeatMessage
    extends DeepMonitorProtocolEnvelope {
    type: "heartbeat";
    clientTimestamp?: number;
}

export type DeepMonitorClientMessage =
    | DeepMonitorHelloMessage
    | DeepMonitorSchemaDeclareMessage
    | DeepMonitorSampleBatchMessage
    | DeepMonitorHeartbeatMessage;

export interface DeepMonitorHelloAckMessage
    extends DeepMonitorProtocolEnvelope {
    type: "helloAck";
    accepted: boolean;
    protocolVersion: number;
    activeSchemaRevision: number | null;
    serverTime?: number;
    supportedProtocolVersions?: number[];
}

export interface DeepMonitorSchemaAckMessage
    extends DeepMonitorProtocolEnvelope {
    type: "schemaAck";
    schemaRevision: number;
    accepted: boolean;
    warnings?: string[];
}

export interface DeepMonitorSampleAckMessage
    extends DeepMonitorProtocolEnvelope {
    type: "sampleAck";
    acceptedCount: number;
    schemaRevision: number;
    lastAcceptedSequence?: number;
    warnings?: string[];
}

export interface DeepMonitorHeartbeatAckMessage
    extends DeepMonitorProtocolEnvelope {
    type: "heartbeatAck";
    timestamp: number;
    serverTime?: number;
}

export interface DeepMonitorErrorMessage
    extends DeepMonitorProtocolEnvelope {
    type: "error";
    code: DeepMonitorProtocolErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
}

export type DeepMonitorServerMessage =
    | DeepMonitorHelloAckMessage
    | DeepMonitorSchemaAckMessage
    | DeepMonitorSampleAckMessage
    | DeepMonitorHeartbeatAckMessage
    | DeepMonitorErrorMessage;