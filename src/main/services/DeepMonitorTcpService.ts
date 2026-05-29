
import {
    createServer as createHttpServer,
    type IncomingMessage,
    type Server as HttpServer,
    type ServerResponse
} from "node:http";
import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import {
    DEEP_MONITOR_DISCOVERY_CONTENT_TYPE,
    DEEP_MONITOR_DISCOVERY_KIND,
    DEEP_MONITOR_DISCOVERY_PATH,
    DEEP_MONITOR_DISCOVERY_PORT,
    DEEP_MONITOR_DISCOVERY_VERSION,
    DEEP_MONITOR_FRAME_HEADER_SIZE,
    DEEP_MONITOR_PROTOCOL_ERROR_CODES,
    DEEP_MONITOR_PROTOCOL_VERSION,
    type DeepMonitorClientMessage,
    type DeepMonitorDiscoveryDocument,
    type DeepMonitorHeartbeatMessage,
    type DeepMonitorHelloMessage,
    type DeepMonitorProtocolErrorCode,
    type DeepMonitorSampleBatchMessage,
    type DeepMonitorSchemaDeclareMessage,
    type DeepMonitorServerMessage
} from "@shared/deepMonitorProtocol";
import type {
    DeepMonitorChartDefinition,
    DeepMonitorConfig,
    DeepMonitorMetricDefinition,
    DeepMonitorSample,
    DeepMonitorSampleValue,
    DeepMonitorSchemaRevision,
    DeepMonitorSessionState
} from "@shared/types";
import { AdbClient } from "@main/adb/AdbClient";

const HOST = "127.0.0.1";

interface StartDeepMonitorSessionOptions {
    serial: string;
    config: DeepMonitorConfig;
    onStateChange: (state: DeepMonitorSessionState) => void;
    onSchemaDeclared: (schema: DeepMonitorSchemaRevision) => Promise<void> | void;
    onSamplesReceived: (samples: DeepMonitorSample[]) => Promise<void> | void;
}

interface ActiveDeepMonitorSession {
    serial: string;
    server: Server;
    discoveryServer: HttpServer;
    config: DeepMonitorConfig;
    state: DeepMonitorSessionState;
    onStateChange: (state: DeepMonitorSessionState) => void;
    onSchemaDeclared: (schema: DeepMonitorSchemaRevision) => Promise<void> | void;
    onSamplesReceived: (samples: DeepMonitorSample[]) => Promise<void> | void;
    clientSocket?: Socket;
    receiveBuffer: Buffer;
    processingChain: Promise<void>;
    protocolReady: boolean;
    activeSchemaRevision?: number;
    activeSchema?: DeepMonitorSchemaRevision;
    stopped: boolean;
}

class DeepMonitorProtocolServiceError extends Error {
    constructor(
        readonly code: DeepMonitorProtocolErrorCode,
        message: string
    ) {
        super(message);
        this.name = "DeepMonitorProtocolServiceError";
    }
}

function normalizePreferredPort(value: number | undefined): number {
    if (!Number.isFinite(value) || value === undefined) {
        return 0;
    }

    const next = Math.floor(value);
    if (next < 0 || next > 65535) {
        return 0;
    }

    return next;
}

function encodeMessage(message: DeepMonitorServerMessage): Buffer {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(DEEP_MONITOR_FRAME_HEADER_SIZE);
    header.writeUInt32BE(payload.length, 0);
    return Buffer.concat([header, payload]);
}

function parseClientMessage(frame: Buffer): DeepMonitorClientMessage {
    let parsed: {
        type?: string;
        [key: string]: unknown;
    };

    try {
        parsed = JSON.parse(frame.toString("utf8")) as {
            type?: string;
            [key: string]: unknown;
        };
    } catch {
        throw new DeepMonitorProtocolServiceError(
            DEEP_MONITOR_PROTOCOL_ERROR_CODES.invalidJson,
            "Invalid deep monitor JSON payload."
        );
    }

    if (parsed.type === "hello") {
        return parsed as unknown as DeepMonitorHelloMessage;
    }

    if (parsed.type === "schemaDeclare") {
        return parsed as unknown as DeepMonitorSchemaDeclareMessage;
    }

    if (parsed.type === "sampleBatch") {
        return parsed as unknown as DeepMonitorSampleBatchMessage;
    }

    if (parsed.type === "heartbeat") {
        return parsed as unknown as DeepMonitorHeartbeatMessage;
    }

    throw new DeepMonitorProtocolServiceError(
        DEEP_MONITOR_PROTOCOL_ERROR_CODES.unsupportedMessageType,
        "Unsupported deep monitor message type."
    );
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Invalid ${fieldName}.`);
    }

    return value.trim();
}

function normalizeMetricDefinitions(
    definitions: DeepMonitorMetricDefinition[]
): DeepMonitorMetricDefinition[] {
    const seen = new Set<string>();

    return definitions.map((definition) => {
        const key = assertNonEmptyString(definition?.key, "metric key");
        if (seen.has(key)) {
            throw new Error(`Duplicate metric key: ${key}`);
        }

        seen.add(key);

        const valueType =
            definition?.valueType === "string" ||
            definition?.valueType === "string-list"
                ? definition.valueType
                : "number";

        return {
            key,
            label: assertNonEmptyString(definition?.label, `label for ${key}`),
            unit: typeof definition?.unit === "string" ? definition.unit : "",
            color:
                typeof definition?.color === "string" && definition.color.trim()
                    ? definition.color.trim()
                    : undefined,
            valueType,
            aggregationHint:
                definition?.aggregationHint === "sum" ||
                definition?.aggregationHint === "average" ||
                definition?.aggregationHint === "max" ||
                definition?.aggregationHint === "min"
                    ? definition.aggregationHint
                    : "last",
            description:
                typeof definition?.description === "string" &&
                definition.description.trim()
                    ? definition.description.trim()
                    : undefined
        };
    });
}

function normalizeChartDefinitions(params: {
    definitions: DeepMonitorChartDefinition[];
    metricDefinitionsByKey: Map<string, DeepMonitorMetricDefinition>;
}): DeepMonitorChartDefinition[] {
    const { definitions, metricDefinitionsByKey } = params;
    const seen = new Set<string>();

    return definitions.map((definition, index) => {
        const id = assertNonEmptyString(definition?.id, "chart id");
        if (seen.has(id)) {
            throw new Error(`Duplicate chart id: ${id}`);
        }

        seen.add(id);

        const nextMetricKeys = Array.isArray(definition?.metricKeys)
            ? definition.metricKeys
                  .map((metricKey: string) =>
                      assertNonEmptyString(metricKey, `${id} metric key`)
                  )
                  .filter(
                      (
                          metricKey: string,
                          metricIndex: number,
                          all: string[]
                      ) => all.indexOf(metricKey) === metricIndex
                  )
            : [];

        if (nextMetricKeys.length === 0) {
            throw new Error(`Chart ${id} has no metric keys.`);
        }

        for (const metricKey of nextMetricKeys) {
            if (!metricDefinitionsByKey.has(metricKey)) {
                throw new Error(`Chart ${id} references unknown metric key ${metricKey}.`);
            }
        }

        const valueTypes = new Set(
            nextMetricKeys.map(
                (metricKey) => metricDefinitionsByKey.get(metricKey)?.valueType ?? "number"
            )
        );

        if (valueTypes.size > 1) {
            throw new Error(
                `Chart ${id} mixes unsupported metric value types.`
            );
        }

        const chartValueType = nextMetricKeys.length > 0
            ? metricDefinitionsByKey.get(nextMetricKeys[0])?.valueType ?? "number"
            : "number";
        const statsEnabled =
            chartValueType === "number" && Boolean(definition?.stats?.enabled);

        const computations = Array.isArray(definition?.stats?.computations)
            ? definition.stats.computations.filter(
                  (
                      value: string
                  ): value is "min" | "max" | "average" =>
                      value === "min" || value === "max" || value === "average"
              )
            : [];

        return {
            id,
            title: assertNonEmptyString(definition?.title, `title for ${id}`),
            metricKeys: nextMetricKeys,
            order:
                typeof definition?.order === "number" && Number.isFinite(definition.order)
                    ? definition.order
                    : index,
            description:
                typeof definition?.description === "string" &&
                definition.description.trim()
                    ? definition.description.trim()
                    : undefined,
            yAxisLabel:
                typeof definition?.yAxisLabel === "string" &&
                definition.yAxisLabel.trim()
                    ? definition.yAxisLabel.trim()
                    : undefined,
            yAxisUnit:
                typeof definition?.yAxisUnit === "string" &&
                definition.yAxisUnit.trim()
                    ? definition.yAxisUnit.trim()
                    : undefined,
            stats: {
                enabled: statsEnabled,
                computations:
                    computations.length > 0
                        ? computations
                        : ["max", "min", "average"],
                scope:
                    definition?.stats?.scope === "whole-session"
                        ? "whole-session"
                        : "visible-range",
                surface:
                    definition?.stats?.surface === "monitor-and-reports" ||
                    definition?.stats?.surface === "monitor-only"
                        ? definition.stats.surface
                        : "reports-only",
                metricKeys: Array.isArray(definition?.stats?.metricKeys)
                    ? definition.stats.metricKeys.filter(
                          (metricKey: string): metricKey is string =>
                              typeof metricKey === "string" &&
                              metricKey.trim().length > 0
                      )
                    : undefined
            }
        };
    });
}

function normalizeSchemaRevision(
    message: DeepMonitorSchemaDeclareMessage
): DeepMonitorSchemaRevision {
    if (!Number.isFinite(message.schemaRevision)) {
        throw new Error("Invalid schema revision.");
    }

    const metrics = normalizeMetricDefinitions(
        Array.isArray(message.metrics) ? message.metrics : []
    );
    const metricDefinitionsByKey = new Map(
        metrics.map((definition) => [definition.key, definition] as const)
    );
    const charts = normalizeChartDefinitions({
        definitions: Array.isArray(message.charts) ? message.charts : [],
        metricDefinitionsByKey
    });

    return {
        revision: Math.floor(message.schemaRevision),
        metrics,
        charts,
        declaredAt: Date.now(),
        protocolVersion: DEEP_MONITOR_PROTOCOL_VERSION
    };
}

function normalizeSampleValue(params: {
    key: string;
    value: unknown;
    definition?: DeepMonitorMetricDefinition;
}): DeepMonitorSampleValue {
    const { key, value, definition } = params;

    if (value === null) {
        return null;
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`Invalid sample value for metric ${key}.`);
        }

        if (definition && definition.valueType !== "number") {
            throw new Error(`Sample value type mismatch for metric ${key}.`);
        }

        return value;
    }

    if (typeof value === "string") {
        if (definition && definition.valueType !== "string") {
            throw new Error(`Sample value type mismatch for metric ${key}.`);
        }

        return value;
    }

    if (Array.isArray(value)) {
        if (!value.every((item) => typeof item === "string")) {
            throw new Error(`Invalid sample value for metric ${key}.`);
        }

        if (definition && definition.valueType !== "string-list") {
            throw new Error(`Sample value type mismatch for metric ${key}.`);
        }

        return [...value];
    }

    throw new Error(`Invalid sample value for metric ${key}.`);
}

function normalizeSamples(
    message: DeepMonitorSampleBatchMessage,
    schema: DeepMonitorSchemaRevision | undefined
): DeepMonitorSample[] {
    if (!Array.isArray(message.samples)) {
        throw new Error("Invalid sample batch payload.");
    }

    const receivedAt = Date.now();
    const metricDefinitionsByKey = new Map(
        (schema?.metrics ?? []).map((definition) => [definition.key, definition] as const)
    );

    return message.samples.map((sample, index) => {
        if (!Number.isFinite(sample?.timestamp)) {
            throw new Error(`Invalid sample timestamp at index ${index}.`);
        }

        if (!sample.values || typeof sample.values !== "object") {
            throw new Error(`Invalid sample values at index ${index}.`);
        }

        const values = Object.fromEntries(
            Object.entries(sample.values).map(([key, value]) => {
                return [
                    key,
                    normalizeSampleValue({
                        key,
                        value,
                        definition: metricDefinitionsByKey.get(key)
                    })
                ] as const;
            })
        );

        return {
            timestamp: Math.floor(sample.timestamp),
            receivedAt,
            schemaRevision: Math.floor(message.schemaRevision),
            values,
            sequence:
                typeof sample.sequence === "number" && Number.isFinite(sample.sequence)
                    ? Math.floor(sample.sequence)
                    : undefined
        };
    });
}

function normalizeHelloMessage(
    message: DeepMonitorHelloMessage
): DeepMonitorHelloMessage {
    if (!Number.isFinite(message.protocolVersion)) {
        throw new DeepMonitorProtocolServiceError(
            DEEP_MONITOR_PROTOCOL_ERROR_CODES.invalidHello,
            "Invalid hello protocolVersion."
        );
    }

    if (typeof message.sessionToken !== "string" || !message.sessionToken.trim()) {
        throw new DeepMonitorProtocolServiceError(
            DEEP_MONITOR_PROTOCOL_ERROR_CODES.invalidHello,
            "Invalid hello sessionToken."
        );
    }

    return {
        ...message,
        protocolVersion: Math.floor(message.protocolVersion),
        sessionToken: message.sessionToken.trim()
    };
}

function wrapProtocolValidationError(
    code: DeepMonitorProtocolErrorCode,
    error: unknown,
    fallbackMessage: string
): DeepMonitorProtocolServiceError {
    if (error instanceof DeepMonitorProtocolServiceError) {
        return error;
    }

    return new DeepMonitorProtocolServiceError(
        code,
        error instanceof Error ? error.message : fallbackMessage
    );
}

function toProtocolError(error: unknown): DeepMonitorProtocolServiceError {
    if (error instanceof DeepMonitorProtocolServiceError) {
        return error;
    }

    return new DeepMonitorProtocolServiceError(
        DEEP_MONITOR_PROTOCOL_ERROR_CODES.internalError,
        error instanceof Error
            ? error.message
            : "Internal deep monitor error."
    );
}

function buildDiscoveryDocument(
    state: DeepMonitorSessionState
): DeepMonitorDiscoveryDocument {
    if (
        typeof state.port !== "number" ||
        typeof state.authToken !== "string" ||
        !state.authToken.trim()
    ) {
        throw new Error("Deep monitor discovery payload is not ready.");
    }

    return {
        kind: DEEP_MONITOR_DISCOVERY_KIND,
        discoveryVersion: DEEP_MONITOR_DISCOVERY_VERSION,
        serverTime: Date.now(),
        stream: {
            host: HOST,
            port: state.port,
            transport: state.transport,
            socketKind: state.socketKind,
            protocolVersion:
                state.protocolVersion ?? DEEP_MONITOR_PROTOCOL_VERSION,
            sessionToken: state.authToken
        },
        session: {
            phase: state.phase,
            activeSchemaRevision: state.activeSchemaRevision ?? null,
            connectedAt: state.connectedAt,
            negotiatedAt: state.negotiatedAt
        }
    };
}

function writeJsonResponse(
    response: ServerResponse,
    statusCode: number,
    payload: unknown
): void {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", DEEP_MONITOR_DISCOVERY_CONTENT_TYPE);
    response.end(JSON.stringify(payload));
}

export class DeepMonitorTcpService {
    private active?: ActiveDeepMonitorSession;

    constructor(private readonly adb: AdbClient) {}

    getState(): DeepMonitorSessionState | undefined {
        return this.active?.state;
    }

    async startSession(
        options: StartDeepMonitorSessionOptions
    ): Promise<DeepMonitorSessionState> {
        if (this.active) {
            throw new Error("Deep monitor session is already running.");
        }

        const preferredPort = normalizePreferredPort(options.config.preferredPort);
        const server = createServer();
        const state: DeepMonitorSessionState = {
            enabled: true,
            transport: "tcp",
            socketKind: "raw-tcp",
            phase: "idle",
            discovery: {
                transport: "http",
                host: HOST,
                port: DEEP_MONITOR_DISCOVERY_PORT,
                path: DEEP_MONITOR_DISCOVERY_PATH
            },
            authToken: randomUUID()
        };
        let active: ActiveDeepMonitorSession;
        const discoveryServer = createHttpServer(
            (request: IncomingMessage, response: ServerResponse) => {
                this.handleDiscoveryRequest(active, request, response);
            }
        );

        active = {
            serial: options.serial,
            server,
            discoveryServer,
            config: options.config,
            state,
            onStateChange: options.onStateChange,
            onSchemaDeclared: options.onSchemaDeclared,
            onSamplesReceived: options.onSamplesReceived,
            receiveBuffer: Buffer.alloc(0),
            processingChain: Promise.resolve(),
            protocolReady: false,
            stopped: false
        };

        this.active = active;
        this.attachServerHandlers(active);

        try {
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(preferredPort, HOST, () => {
                    server.removeListener("error", reject);
                    resolve();
                });
            });

            await new Promise<void>((resolve, reject) => {
                discoveryServer.once("error", reject);
                discoveryServer.listen(DEEP_MONITOR_DISCOVERY_PORT, HOST, () => {
                    discoveryServer.removeListener("error", reject);
                    resolve();
                });
            });

            const address = server.address();
            if (!address || typeof address === "string") {
                throw new Error("Failed to determine deep monitor TCP port.");
            }

            state.port = address.port;

            await this.adb.reverseTcp(options.serial, address.port, address.port);
            await this.adb.reverseTcp(
                options.serial,
                DEEP_MONITOR_DISCOVERY_PORT,
                DEEP_MONITOR_DISCOVERY_PORT
            );
        } catch (error) {
            await this.stopSession();
            throw error;
        }

        this.updateState(active, {
            phase: "waiting-for-client",
            port: state.port
        });

        return active.state;
    }

    async stopSession(): Promise<void> {
        const active = this.active;
        if (!active) {
            return;
        }

        active.stopped = true;

        if (active.state.port) {
            await this.adb.removeReverseTcp(active.serial, active.state.port);
        }

        await this.adb.removeReverseTcp(
            active.serial,
            DEEP_MONITOR_DISCOVERY_PORT
        );

        active.clientSocket?.destroy();

        await new Promise<void>((resolve) => {
            active.server.close(() => resolve());
        });

        await new Promise<void>((resolve) => {
            active.discoveryServer.close(() => resolve());
        });

        this.updateState(active, {
            phase: "closed"
        });
        this.active = undefined;
    }

    private attachServerHandlers(active: ActiveDeepMonitorSession): void {
        active.server.on("connection", (socket) => {
            if (active.stopped) {
                socket.destroy();
                return;
            }

            if (active.clientSocket && !active.clientSocket.destroyed) {
                this.sendMessage(socket, {
                    type: "error",
                    code: DEEP_MONITOR_PROTOCOL_ERROR_CODES.sessionBusy,
                    message: "A deep monitor client is already connected."
                });
                socket.destroy();
                return;
            }

            active.clientSocket = socket;
            active.receiveBuffer = Buffer.alloc(0);
            active.processingChain = Promise.resolve();
            active.protocolReady = false;
            this.updateState(active, {
                phase: "connected",
                connectedAt: Date.now(),
                lastError: undefined
            });

            socket.on("data", (chunk: Buffer) => {
                active.receiveBuffer = Buffer.concat([active.receiveBuffer, chunk]);
                let frames: Buffer[] = [];

                try {
                    frames = this.extractFrames(active);
                } catch (error) {
                    const protocolError = toProtocolError(error);
                    this.rejectSocket(
                        active,
                        socket,
                        protocolError.code,
                        protocolError.message
                    );
                    return;
                }

                for (const frame of frames) {
                    active.processingChain = active.processingChain
                        .then(() => this.handleFrame(active, socket, frame))
                        .catch((error) => {
                            const protocolError = toProtocolError(error);
                            this.rejectSocket(
                                active,
                                socket,
                                protocolError.code,
                                protocolError.message
                            );
                        });
                }
            });

            socket.on("close", () => {
                if (active.clientSocket !== socket) {
                    return;
                }

                active.clientSocket = undefined;
                active.receiveBuffer = Buffer.alloc(0);
                active.processingChain = Promise.resolve();
                active.protocolReady = false;
                if (!active.stopped) {
                    this.updateState(active, {
                        phase: "waiting-for-client"
                    });
                }
            });

            socket.on("error", (error) => {
                if (active.clientSocket !== socket) {
                    return;
                }

                this.updateState(active, {
                    phase: "error",
                    lastError: error.message
                });
            });
        });

        active.server.on("error", (error) => {
            this.updateState(active, {
                phase: "error",
                lastError: error.message
            });
        });

        active.discoveryServer.on("error", (error) => {
            this.updateState(active, {
                phase: "error",
                lastError: error.message
            });
        });
    }

    private handleDiscoveryRequest(
        active: ActiveDeepMonitorSession,
        request: IncomingMessage,
        response: ServerResponse
    ): void {
        const requestUrl = new URL(request.url ?? "/", `http://${HOST}`);

        if (
            request.method !== "GET" ||
            requestUrl.pathname !== DEEP_MONITOR_DISCOVERY_PATH
        ) {
            writeJsonResponse(response, 404, {
                error: "NOT_FOUND",
                message: "Deep monitor discovery endpoint not found."
            });
            return;
        }

        if (
            typeof active.state.port !== "number" ||
            typeof active.state.authToken !== "string" ||
            !active.state.authToken.trim()
        ) {
            writeJsonResponse(response, 503, {
                error: "DISCOVERY_NOT_READY",
                message: "Deep monitor discovery endpoint is not ready."
            });
            return;
        }

        writeJsonResponse(response, 200, buildDiscoveryDocument(active.state));
    }

    private extractFrames(active: ActiveDeepMonitorSession): Buffer[] {
        const frames: Buffer[] = [];

        while (active.receiveBuffer.length >= DEEP_MONITOR_FRAME_HEADER_SIZE) {
            const length = active.receiveBuffer.readUInt32BE(0);
            if (length <= 0) {
                throw new DeepMonitorProtocolServiceError(
                    DEEP_MONITOR_PROTOCOL_ERROR_CODES.invalidFrame,
                    "Invalid deep monitor frame length."
                );
            }

            if (
                active.receiveBuffer.length <
                DEEP_MONITOR_FRAME_HEADER_SIZE + length
            ) {
                break;
            }

            frames.push(
                active.receiveBuffer.subarray(
                    DEEP_MONITOR_FRAME_HEADER_SIZE,
                    DEEP_MONITOR_FRAME_HEADER_SIZE + length
                )
            );
            active.receiveBuffer = active.receiveBuffer.subarray(
                DEEP_MONITOR_FRAME_HEADER_SIZE + length
            );
        }

        return frames;
    }

    private async handleFrame(
        active: ActiveDeepMonitorSession,
        socket: Socket,
        frame: Buffer
    ): Promise<void> {
        const message = parseClientMessage(frame);

        if (message.type === "hello") {
            await this.handleHello(active, socket, message);
            return;
        }

        if (!active.protocolReady) {
            throw new DeepMonitorProtocolServiceError(
                DEEP_MONITOR_PROTOCOL_ERROR_CODES.helloRequired,
                "Deep monitor protocol hello must be sent first."
            );
        }

        if (message.type === "schemaDeclare") {
            let schema: DeepMonitorSchemaRevision;

            try {
                schema = normalizeSchemaRevision(message);
            } catch (error) {
                throw wrapProtocolValidationError(
                    DEEP_MONITOR_PROTOCOL_ERROR_CODES.invalidSchema,
                    error,
                    "Invalid deep monitor schema."
                );
            }

            active.activeSchemaRevision = schema.revision;
            active.activeSchema = schema;
            this.updateState(active, {
                phase: "ready",
                protocolVersion: DEEP_MONITOR_PROTOCOL_VERSION,
                activeSchemaRevision: schema.revision,
                negotiatedAt: Date.now()
            });
            await active.onSchemaDeclared(schema);
            this.sendMessage(socket, {
                type: "schemaAck",
                schemaRevision: schema.revision,
                accepted: true
            });
            return;
        }

        if (message.type === "sampleBatch") {
            if (active.activeSchemaRevision !== Math.floor(message.schemaRevision)) {
                throw new DeepMonitorProtocolServiceError(
                    DEEP_MONITOR_PROTOCOL_ERROR_CODES.schemaRevisionMismatch,
                    "Sample batch schema revision is not active."
                );
            }

            let samples: DeepMonitorSample[];

            try {
                samples = normalizeSamples(message, active.activeSchema);
            } catch (error) {
                throw wrapProtocolValidationError(
                    DEEP_MONITOR_PROTOCOL_ERROR_CODES.invalidSampleBatch,
                    error,
                    "Invalid deep monitor sample batch."
                );
            }

            await active.onSamplesReceived(samples);
            this.updateState(active, {
                phase: "streaming"
            });
            this.sendMessage(socket, {
                type: "sampleAck",
                acceptedCount: samples.length,
                schemaRevision: Math.floor(message.schemaRevision)
            });
            return;
        }

        if (message.type === "heartbeat") {
            this.sendMessage(socket, {
                type: "heartbeatAck",
                timestamp: Date.now()
            });
        }
    }

    private async handleHello(
        active: ActiveDeepMonitorSession,
        socket: Socket,
        message: DeepMonitorHelloMessage
    ): Promise<void> {
        const normalizedMessage = normalizeHelloMessage(message);

        if (normalizedMessage.protocolVersion !== DEEP_MONITOR_PROTOCOL_VERSION) {
            throw new DeepMonitorProtocolServiceError(
                DEEP_MONITOR_PROTOCOL_ERROR_CODES.unsupportedProtocolVersion,
                `Unsupported deep monitor protocol version ${normalizedMessage.protocolVersion}.`
            );
        }

        if (normalizedMessage.sessionToken !== active.state.authToken) {
            throw new DeepMonitorProtocolServiceError(
                DEEP_MONITOR_PROTOCOL_ERROR_CODES.authTokenMismatch,
                "Deep monitor session token mismatch."
            );
        }

        active.protocolReady = true;
        this.updateState(active, {
            phase: "negotiating",
            protocolVersion: DEEP_MONITOR_PROTOCOL_VERSION,
            lastError: undefined
        });
        this.sendMessage(socket, {
            type: "helloAck",
            accepted: true,
            protocolVersion: DEEP_MONITOR_PROTOCOL_VERSION,
            activeSchemaRevision: active.activeSchemaRevision ?? null
        });
    }

    private rejectSocket(
        active: ActiveDeepMonitorSession,
        socket: Socket,
        code: DeepMonitorProtocolErrorCode,
        message: string
    ): void {
        this.sendMessage(socket, {
            type: "error",
            code,
            message
        });
        this.updateState(active, {
            phase: "rejected",
            lastError: message
        });
        socket.destroy();
    }

    private sendMessage(socket: Socket, message: DeepMonitorServerMessage): void {
        if (socket.destroyed) {
            return;
        }

        socket.write(encodeMessage(message));
    }

    private updateState(
        active: ActiveDeepMonitorSession,
        patch: Partial<DeepMonitorSessionState>
    ): void {
        active.state = {
            ...active.state,
            ...patch
        };
        active.onStateChange(active.state);
    }
}