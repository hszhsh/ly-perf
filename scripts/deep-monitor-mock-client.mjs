import net from "node:net";
import process from "node:process";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_DISCOVERY_URL =
    "http://127.0.0.1:27183/deep-monitor/discovery";
const DEFAULT_SCHEMA_REVISION = 1;
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_HEARTBEAT_MS = 15000;
const DEFAULT_DURATION_MS = 30000;
const DEFAULT_BATCH_SIZE = 1;
const FRAME_HEADER_SIZE = 4;

function printUsage() {
    console.log(`Usage:
    npm run deep-monitor:mock
    npm run deep-monitor:mock -- --discovery-url <url>
    npm run deep-monitor:mock -- --port <port> --token <authToken> [options]

Options:
    --discovery-url <url>          Discovery endpoint, default http://127.0.0.1:27183/deep-monitor/discovery
    --host <host>                  TCP host override for direct mode, default 127.0.0.1
    --port <port>                  Direct TCP port override for manual mode
    --token <token>                Direct session token override for manual mode
  --schema-revision <number>     Schema revision, default 1
  --interval-ms <number>         Sample batch interval, default 1000
  --heartbeat-ms <number>        Heartbeat interval, default 15000
  --duration-ms <number>         Total run duration, default 30000; use 0 to stream until Ctrl+C
  --batch-size <number>          Samples per batch, default 1
  --help                         Show this message

Environment fallback:
    DEEP_MONITOR_DISCOVERY_URL
  DEEP_MONITOR_HOST
  DEEP_MONITOR_PORT
  DEEP_MONITOR_TOKEN
`);
}

function parseArgs(argv) {
    const result = {};

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith("--")) {
            continue;
        }

        const key = arg.slice(2);
        if (key === "help") {
            result.help = true;
            continue;
        }

        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
            throw new Error(`Missing value for --${key}`);
        }

        result[key] = value;
        index += 1;
    }

    return result;
}

function parseInteger(value, fallback, fieldName, { min = 0 } = {}) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    const next = Number.parseInt(String(value), 10);
    if (!Number.isFinite(next) || next < min) {
        throw new Error(`Invalid ${fieldName}: ${value}`);
    }

    return next;
}

function encodeFrame(message) {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(FRAME_HEADER_SIZE);
    header.writeUInt32BE(payload.length, 0);
    return Buffer.concat([header, payload]);
}

function decodeFrames(buffer) {
    const messages = [];
    let offset = 0;

    while (buffer.length - offset >= FRAME_HEADER_SIZE) {
        const payloadLength = buffer.readUInt32BE(offset);
        if (payloadLength <= 0) {
            throw new Error("Invalid frame length received from server.");
        }

        const frameEnd = offset + FRAME_HEADER_SIZE + payloadLength;
        if (buffer.length < frameEnd) {
            break;
        }

        const payload = buffer.subarray(offset + FRAME_HEADER_SIZE, frameEnd);
        messages.push(JSON.parse(payload.toString("utf8")));
        offset = frameEnd;
    }

    return {
        messages,
        remaining: buffer.subarray(offset)
    };
}

function buildDemoSchema(schemaRevision) {
    return {
        type: "schemaDeclare",
        schemaRevision,
        metrics: [
            {
                key: "renderLatencyMs",
                label: "Render Latency",
                unit: "ms",
                color: "#d55454",
                valueType: "number",
                aggregationHint: "last",
                description: "Frame render latency reported by the app"
            },
            {
                key: "sceneNodes",
                label: "Scene Nodes",
                unit: "count",
                color: "#1b8ef2",
                valueType: "number",
                aggregationHint: "max",
                description: "Approximate number of active scene nodes"
            },
            {
                key: "textureUploadKb",
                label: "Texture Upload",
                unit: "KB",
                color: "#ff9f1c",
                valueType: "number",
                aggregationHint: "sum",
                description: "Texture upload volume per sample interval"
            },
            {
                key: "activeTimelineIds",
                label: "Active Timeline IDs",
                unit: "",
                color: "#ffd54f",
                valueType: "string-list",
                aggregationHint: "last",
                description: "Example non-numeric state list rendered as a state timeline"
            }
        ],
        charts: [
            {
                id: "render-latency",
                title: "Render Latency",
                metricKeys: ["renderLatencyMs"],
                order: 0,
                yAxisLabel: "Latency",
                yAxisUnit: "ms",
                stats: {
                    enabled: true,
                    computations: ["max", "min", "average"],
                    scope: "visible-range",
                    surface: "reports-only"
                }
            },
            {
                id: "scene-pressure",
                title: "Scene Pressure",
                metricKeys: ["sceneNodes", "textureUploadKb"],
                order: 1,
                yAxisLabel: "Load",
                stats: {
                    enabled: true,
                    computations: ["max", "average"],
                    scope: "visible-range",
                    surface: "reports-only"
                }
            },
            {
                id: "active-timelines",
                title: "Active Timelines",
                metricKeys: ["activeTimelineIds"],
                order: 2,
                stats: {
                    enabled: false,
                    computations: ["max", "average"],
                    scope: "visible-range",
                    surface: "reports-only"
                }
            }
        ]
    };
}

function buildSample(sequence, timestamp, schemaRevision) {
    const waveA = Math.sin(sequence / 5);
    const waveB = Math.cos(sequence / 7);
    const burst = sequence % 9 === 0 ? 180 : 0;
    const activeTimelineIds = ["timeline/main-loop"];

    if (sequence % 12 < 4) {
        activeTimelineIds.push("timeline/hook-charge");
    }

    if (sequence % 20 >= 10 && sequence % 20 < 16) {
        activeTimelineIds.push("timeline/bonus-window");
    }

    return {
        timestamp,
        sequence,
        schemaRevision,
        values: {
            renderLatencyMs: Number((16 + waveA * 5 + Math.random() * 1.2).toFixed(2)),
            sceneNodes: Math.max(800, Math.round(1200 + waveB * 140)),
            textureUploadKb: Math.max(0, Math.round(220 + waveA * 45 + burst)),
            activeTimelineIds
        }
    };
}

function createSampleBatch(sequenceStart, batchSize, schemaRevision) {
    const now = Date.now();
    const samples = [];

    for (let index = 0; index < batchSize; index += 1) {
        const sequence = sequenceStart + index;
        const timestamp = now + index * 16;
        const sample = buildSample(sequence, timestamp, schemaRevision);
        samples.push({
            timestamp: sample.timestamp,
            sequence: sample.sequence,
            values: sample.values
        });
    }

    return {
        type: "sampleBatch",
        schemaRevision,
        samples
    };
}

function logMessage(direction, message) {
    console.log(`[${direction}] ${JSON.stringify(message)}`);
}

async function fetchDiscovery(discoveryUrl) {
    console.log(`Fetching discovery document from ${discoveryUrl}`);

    let response;

    try {
        response = await fetch(discoveryUrl, {
            method: "GET",
            headers: {
                accept: "application/json"
            }
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        throw new Error(
            `Failed to reach discovery endpoint ${discoveryUrl}. Ensure the desktop monitor is running, deep monitor is enabled, and adb reverse is active. Original error: ${reason}`
        );
    }

    const body = await response.text();

    if (!response.ok) {
        throw new Error(
            `Discovery request failed (${response.status} ${response.statusText}): ${body}`
        );
    }

    let document;
    try {
        document = JSON.parse(body);
    } catch {
        throw new Error(`Discovery payload is not valid JSON: ${body}`);
    }

    if (document?.kind !== "ly-perf.deep-monitor.discovery") {
        throw new Error(`Unexpected discovery kind: ${document?.kind ?? "<missing>"}`);
    }

    if (!Number.isFinite(document?.discoveryVersion)) {
        throw new Error("Discovery payload is missing discoveryVersion.");
    }

    if (Math.floor(document.discoveryVersion) !== 1) {
        throw new Error(
            `Unsupported discovery version: ${document.discoveryVersion}`
        );
    }

    const stream = document?.stream;
    if (!stream || typeof stream !== "object") {
        throw new Error("Discovery payload is missing stream information.");
    }

    const host =
        typeof stream.host === "string" && stream.host.trim()
            ? stream.host.trim()
            : DEFAULT_HOST;
    const port = Number.parseInt(String(stream.port), 10);
    const token =
        typeof stream.sessionToken === "string" && stream.sessionToken.trim()
            ? stream.sessionToken.trim()
            : "";
    const protocolVersion = Number.parseInt(
        String(stream.protocolVersion ?? 1),
        10
    );

    if (!Number.isFinite(port) || port <= 0) {
        throw new Error("Discovery payload does not contain a valid stream.port.");
    }

    if (!token) {
        throw new Error(
            "Discovery payload does not contain a valid stream.sessionToken."
        );
    }

    if (!Number.isFinite(protocolVersion) || protocolVersion <= 0) {
        throw new Error(
            "Discovery payload does not contain a valid stream.protocolVersion."
        );
    }

    console.log(
        `Discovered stream target ${host}:${port} with protocol v${protocolVersion}`
    );

    return {
        host,
        port,
        token,
        protocolVersion
    };
}

function shouldPrintUsageOnError(message) {
    return (
        message.includes("Missing value for --") ||
        message.includes("Invalid ") ||
        message.includes(" is required") ||
        message.includes("Direct mode requires both --port and --token")
    );
}

async function main() {
    const rawArgs = parseArgs(process.argv.slice(2));
    if (rawArgs.help) {
        printUsage();
        return;
    }

    const discoveryUrl =
        rawArgs["discovery-url"] ??
        process.env.DEEP_MONITOR_DISCOVERY_URL ??
        DEFAULT_DISCOVERY_URL;
    const directHost = rawArgs.host ?? process.env.DEEP_MONITOR_HOST ?? DEFAULT_HOST;
    const directPortValue = rawArgs.port ?? process.env.DEEP_MONITOR_PORT;
    const directTokenValue = rawArgs.token ?? process.env.DEEP_MONITOR_TOKEN;
    const hasDirectPort = directPortValue !== undefined && directPortValue !== "";
    const hasDirectToken =
        directTokenValue !== undefined && String(directTokenValue).trim() !== "";

    if (hasDirectPort !== hasDirectToken) {
        throw new Error(
            "Direct mode requires both --port and --token (or both DEEP_MONITOR_PORT and DEEP_MONITOR_TOKEN)."
        );
    }

    const connectionTarget = hasDirectPort
        ? {
              host: directHost,
              port: parseInteger(directPortValue, NaN, "port", { min: 1 }),
              token: String(directTokenValue).trim(),
              protocolVersion: 1
          }
        : await fetchDiscovery(discoveryUrl);

    const schemaRevision = parseInteger(
        rawArgs["schema-revision"],
        DEFAULT_SCHEMA_REVISION,
        "schema revision",
        { min: 1 }
    );
    const intervalMs = parseInteger(
        rawArgs["interval-ms"],
        DEFAULT_INTERVAL_MS,
        "interval ms",
        { min: 50 }
    );
    const heartbeatMs = parseInteger(
        rawArgs["heartbeat-ms"],
        DEFAULT_HEARTBEAT_MS,
        "heartbeat ms",
        { min: 1000 }
    );
    const durationMs = parseInteger(
        rawArgs["duration-ms"],
        DEFAULT_DURATION_MS,
        "duration ms",
        { min: 0 }
    );
    const batchSize = parseInteger(
        rawArgs["batch-size"],
        DEFAULT_BATCH_SIZE,
        "batch size",
        { min: 1 }
    );

    const socket = net.createConnection({
        host: connectionTarget.host,
        port: connectionTarget.port
    });
    let receiveBuffer = Buffer.alloc(0);
    let heartbeatTimer;
    let sampleTimer;
    let durationTimer;
    let nextSequence = 1;
    let schemaAccepted = false;

    const cleanup = (exitCode = 0) => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = undefined;
        }

        if (sampleTimer) {
            clearInterval(sampleTimer);
            sampleTimer = undefined;
        }

        if (durationTimer) {
            clearTimeout(durationTimer);
            durationTimer = undefined;
        }

        if (!socket.destroyed) {
            socket.end();
        }

        if (exitCode >= 0) {
            process.exitCode = exitCode;
        }
    };

    const send = (message) => {
        logMessage("send", message);
        socket.write(encodeFrame(message));
    };

    const startStreaming = () => {
        if (sampleTimer) {
            return;
        }

        sampleTimer = setInterval(() => {
            const message = createSampleBatch(nextSequence, batchSize, schemaRevision);
            nextSequence += batchSize;
            send(message);
        }, intervalMs);

        heartbeatTimer = setInterval(() => {
            send({ type: "heartbeat" });
        }, heartbeatMs);

        const initialBatch = createSampleBatch(nextSequence, batchSize, schemaRevision);
        nextSequence += batchSize;
        send(initialBatch);
    };

    socket.on("connect", () => {
        console.log(
            `Connected to ${connectionTarget.host}:${connectionTarget.port}`
        );
        send({
            type: "hello",
            protocolVersion: connectionTarget.protocolVersion,
            sessionToken: connectionTarget.token
        });

        if (durationMs > 0) {
            durationTimer = setTimeout(() => {
                console.log(`Reached duration limit (${durationMs}ms), stopping client.`);
                cleanup(0);
            }, durationMs);
        }
    });

    socket.on("data", (chunk) => {
        receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
        const decoded = decodeFrames(receiveBuffer);
        receiveBuffer = decoded.remaining;

        for (const message of decoded.messages) {
            logMessage("recv", message);

            if (message.type === "helloAck") {
                send(buildDemoSchema(schemaRevision));
                continue;
            }

            if (message.type === "schemaAck") {
                schemaAccepted = true;
                startStreaming();
                continue;
            }

            if (message.type === "sampleAck" || message.type === "heartbeatAck") {
                continue;
            }

            if (message.type === "error") {
                throw new Error(`${message.code}: ${message.message}`);
            }
        }
    });

    socket.on("close", () => {
        console.log(
            schemaAccepted
                ? "Server closed the deep monitor connection."
                : "Connection closed before schema negotiation completed."
        );
        cleanup(schemaAccepted ? 0 : 1);
    });

    socket.on("error", (error) => {
        console.error(`Socket error: ${error.message}`);
        cleanup(1);
    });

    process.on("SIGINT", () => {
        console.log("Received SIGINT, stopping client.");
        cleanup(0);
    });
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);

    if (shouldPrintUsageOnError(message)) {
        printUsage();
    }

    process.exitCode = 1;
});