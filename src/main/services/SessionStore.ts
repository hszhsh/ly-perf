import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
    DeviceInfo,
    MonitorConfig,
    MonitorSample,
    SessionDetail,
    SessionTimelineEvent,
    SessionTimelineEventInput,
    SessionPersistenceState,
    SessionTimelineEventUpdate,
    SessionSummary
} from "@shared/types";

interface SessionJournalMetadata extends Omit<SessionDetail, "samples"> {
    sampleCount: number;
}

function isValidEventType(
    value: string | undefined
): value is SessionTimelineEvent["type"] {
    return value === "note" || value === "action" || value === "issue";
}

export class SessionStore {
    private readonly sessionsDir: string;
    private readonly screenshotsDir: string;
    private readonly exportsDir: string;
    private readonly journalsDir: string;

    constructor(private readonly dataDir: string) {
        this.sessionsDir = path.join(this.dataDir, "sessions");
        this.screenshotsDir = path.join(this.dataDir, "screenshots");
        this.exportsDir = path.join(this.dataDir, "exports");
        this.journalsDir = path.join(this.dataDir, "journals");
    }

    async init(): Promise<void> {
        await fs.mkdir(this.sessionsDir, { recursive: true });
        await fs.mkdir(this.screenshotsDir, { recursive: true });
        await fs.mkdir(this.journalsDir, { recursive: true });
    }

    getDataDir(): string {
        return this.dataDir;
    }

    getScreenshotDir(sessionId: string): string {
        return path.join(this.screenshotsDir, sessionId);
    }

    createSession(
        config: MonitorConfig,
        deviceInfo: DeviceInfo
    ): SessionDetail {
        const now = Date.now();

        return {
            id: randomUUID(),
            serial: config.serial,
            packageName: config.packageName,
            displayName: config.packageName,
            startedAt: now,
            endedAt: now,
            sampleCount: 0,
            persistenceState: "finalized",
            config,
            deviceInfo,
            samples: [],
            events: []
        };
    }

    async initializeSessionJournal(session: SessionDetail): Promise<void> {
        const normalized = this.normalizeSession(session);
        const journalDir = this.getSessionJournalDir(normalized.id);

        await fs.mkdir(journalDir, { recursive: true });
        await fs.writeFile(
            this.getSessionJournalMetaPath(normalized.id),
            JSON.stringify(this.toJournalMetadata(normalized), null, 2),
            "utf8"
        );
        await fs.writeFile(
            this.getSessionJournalSamplesPath(normalized.id),
            "",
            "utf8"
        );
    }

    async appendSessionSample(
        sessionId: string,
        sample: MonitorSample
    ): Promise<void> {
        const journalPath = this.getSessionJournalSamplesPath(sessionId);

        await fs.mkdir(this.getSessionJournalDir(sessionId), {
            recursive: true
        });
        await fs.appendFile(journalPath, `${JSON.stringify(sample)}\n`, "utf8");
    }

    async updateSessionJournalMetadata(session: SessionDetail): Promise<void> {
        const normalized = this.normalizeSession(session);

        await fs.mkdir(this.getSessionJournalDir(normalized.id), {
            recursive: true
        });
        await fs.writeFile(
            this.getSessionJournalMetaPath(normalized.id),
            JSON.stringify(this.toJournalMetadata(normalized), null, 2),
            "utf8"
        );
    }

    async finalizeSessionJournal(session: SessionDetail): Promise<void> {
        await this.saveSession(session);
        await this.deleteSessionJournal(session.id);
    }

    async saveSession(session: SessionDetail): Promise<void> {
        const normalized = this.normalizeSession(session);

        await fs.mkdir(this.sessionsDir, { recursive: true });
        await fs.writeFile(
            this.getSessionFilePath(normalized.id),
            JSON.stringify(normalized, null, 2),
            "utf8"
        );
    }

    async listSessions(): Promise<SessionSummary[]> {
        await fs.mkdir(this.sessionsDir, { recursive: true });
        await fs.mkdir(this.journalsDir, { recursive: true });

        const files = await fs.readdir(this.sessionsDir);
        const sessions: SessionSummary[] = [];
        const seenSessionIds = new Set<string>();

        for (const file of files) {
            if (!file.endsWith(".json")) {
                continue;
            }

            const filePath = path.join(this.sessionsDir, file);

            try {
                const content = await fs.readFile(filePath, "utf8");
                const parsed = this.normalizeSession(
                    JSON.parse(content) as SessionDetail
                );

                sessions.push(this.toSessionSummary(parsed));
                seenSessionIds.add(parsed.id);
            } catch (error) {
                console.warn(`Skip invalid session file ${filePath}:`, error);
            }
        }

        const journalEntries = await fs.readdir(this.journalsDir, {
            withFileTypes: true
        });

        for (const entry of journalEntries) {
            if (!entry.isDirectory() || seenSessionIds.has(entry.name)) {
                continue;
            }

            try {
                const recovered = await this.loadSessionFromJournal(entry.name);
                sessions.push(this.toSessionSummary(recovered));
            } catch (error) {
                console.warn(
                    `Skip invalid session journal ${entry.name}:`,
                    error
                );
            }
        }

        return sessions.sort((a, b) => b.startedAt - a.startedAt);
    }

    async getSession(sessionId: string): Promise<SessionDetail> {
        const filePath = this.getSessionFilePath(sessionId);

        try {
            const content = await fs.readFile(filePath, "utf8");
            return this.normalizeSession(JSON.parse(content) as SessionDetail);
        } catch (error) {
            if (
                (error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT"
            ) {
                throw error;
            }
        }

        return this.loadSessionFromJournal(sessionId);
    }

    async createSessionEvent(
        sessionId: string,
        input: SessionTimelineEventInput
    ): Promise<SessionDetail> {
        const session = await this.getSession(sessionId);
        const updated = this.withCreatedEvent(session, input);

        await this.saveSession(updated);

        return updated;
    }

    async updateSessionEvent(
        sessionId: string,
        input: SessionTimelineEventUpdate
    ): Promise<SessionDetail> {
        const session = await this.getSession(sessionId);
        const updated = this.withUpdatedEvent(session, input);

        await this.saveSession(updated);

        return updated;
    }

    async deleteSessionEvent(
        sessionId: string,
        eventId: string
    ): Promise<SessionDetail> {
        const session = await this.getSession(sessionId);
        const updated = this.withDeletedEvent(session, eventId);

        await this.saveSession(updated);

        return updated;
    }

    withCreatedEvent(
        session: SessionDetail,
        input: SessionTimelineEventInput
    ): SessionDetail {
        const timestamp = this.normalizeEventTimestamp(input.timestamp);
        const text = this.normalizeEventText(input.text);
        const color = this.normalizeEventColor(input.color);
        const type = this.normalizeEventType(input.type);
        const now = Date.now();
        const nextEvent: SessionTimelineEvent = {
            id: randomUUID(),
            timestamp,
            type,
            color,
            text,
            createdAt: now,
            updatedAt: now
        };

        return this.normalizeSession({
            ...session,
            events: [...session.events, nextEvent]
        });
    }

    withUpdatedEvent(
        session: SessionDetail,
        input: SessionTimelineEventUpdate
    ): SessionDetail {
        const eventId = input.id.trim();
        if (!eventId) {
            throw new Error("事件 ID 无效。");
        }

        const existingEvent = session.events.find((event) => event.id === eventId);
        if (!existingEvent) {
            throw new Error("未找到要更新的事件。");
        }

        const timestamp = this.normalizeEventTimestamp(input.timestamp);
        const text = this.normalizeEventText(input.text);
        const color = this.normalizeEventColor(input.color);
        const type = this.normalizeEventType(input.type);
        const updatedAt = Date.now();

        return this.normalizeSession({
            ...session,
            events: session.events.map((event) =>
                event.id === eventId
                    ? {
                          ...event,
                          timestamp,
                          type,
                          color,
                          text,
                          updatedAt
                      }
                    : event
            )
        });
    }

    withDeletedEvent(session: SessionDetail, eventId: string): SessionDetail {
        const normalizedEventId = eventId.trim();
        if (!normalizedEventId) {
            throw new Error("事件 ID 无效。");
        }

        if (!session.events.some((event) => event.id === normalizedEventId)) {
            throw new Error("未找到要删除的事件。");
        }

        return this.normalizeSession({
            ...session,
            events: session.events.filter(
                (event) => event.id !== normalizedEventId
            )
        });
    }

    async renameSession(
        sessionId: string,
        displayName: string
    ): Promise<SessionDetail> {
        const normalizedDisplayName = displayName.trim();

        if (!normalizedDisplayName) {
            throw new Error("Session name cannot be empty.");
        }

        const session = await this.getSession(sessionId);
        const renamed: SessionDetail = {
            ...session,
            displayName: normalizedDisplayName
        };

        await this.saveSession(renamed);

        return renamed;
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.getSession(sessionId);

        await fs.rm(this.getSessionFilePath(sessionId), { force: true });
        await fs.rm(this.getScreenshotDir(sessionId), {
            force: true,
            recursive: true
        });
        await fs.rm(this.getExportDir(sessionId), {
            force: true,
            recursive: true
        });
        await this.deleteSessionJournal(sessionId);
    }

    private normalizeSession(session: SessionDetail): SessionDetail {
        return {
            ...session,
            displayName: session.displayName?.trim() || session.packageName,
            endedAt: session.endedAt || Date.now(),
            persistenceState: this.normalizePersistenceState(
                session.persistenceState
            ),
            sampleCount: session.samples.length,
            events: this.normalizeEvents(session.events)
        };
    }

    private normalizeEvents(
        events: SessionTimelineEvent[] | undefined
    ): SessionTimelineEvent[] {
        if (!Array.isArray(events)) {
            return [];
        }

        return events
            .map((event) => {
                const normalizedText = event?.text?.trim();
                if (
                    !event ||
                    typeof event.id !== "string" ||
                    !event.id ||
                    typeof event.timestamp !== "number" ||
                    !Number.isFinite(event.timestamp) ||
                    !isValidEventType(event.type) ||
                    typeof event.color !== "string" ||
                    !event.color ||
                    !normalizedText
                ) {
                    return null;
                }

                const createdAt =
                    typeof event.createdAt === "number" &&
                    Number.isFinite(event.createdAt)
                        ? event.createdAt
                        : event.timestamp;
                const updatedAt =
                    typeof event.updatedAt === "number" &&
                    Number.isFinite(event.updatedAt)
                        ? event.updatedAt
                        : createdAt;

                return {
                    id: event.id,
                    timestamp: event.timestamp,
                    type: event.type,
                    color: event.color,
                    text: normalizedText,
                    createdAt,
                    updatedAt
                } satisfies SessionTimelineEvent;
            })
            .filter(
                (event): event is SessionTimelineEvent => event !== null
            )
            .sort((left, right) => left.timestamp - right.timestamp);
    }

    private normalizeEventTimestamp(timestamp: number): number {
        if (!Number.isFinite(timestamp)) {
            throw new Error("事件时间无效。");
        }

        return Math.floor(timestamp);
    }

    private normalizeEventText(text: string): string {
        const normalizedText = text?.trim();

        if (!normalizedText) {
            throw new Error("事件内容不能为空。");
        }

        return normalizedText;
    }

    private normalizeEventColor(color: string): string {
        const normalizedColor = color?.trim();

        if (!normalizedColor) {
            throw new Error("事件颜色不能为空。");
        }

        return normalizedColor;
    }

    private normalizeEventType(
        type: SessionTimelineEventInput["type"] | undefined
    ): SessionTimelineEvent["type"] {
        if (!isValidEventType(type)) {
            throw new Error("事件类型无效。");
        }

        return type;
    }

    private normalizePersistenceState(
        state: SessionPersistenceState | undefined
    ): SessionPersistenceState {
        return state === "recovered" ? "recovered" : "finalized";
    }

    private toSessionSummary(session: SessionDetail): SessionSummary {
        return {
            id: session.id,
            serial: session.serial,
            packageName: session.packageName,
            displayName: session.displayName,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            sampleCount: session.samples.length,
            persistenceState: session.persistenceState
        };
    }

    private toJournalMetadata(session: SessionDetail): SessionJournalMetadata {
        return {
            id: session.id,
            serial: session.serial,
            packageName: session.packageName,
            displayName: session.displayName,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            sampleCount: session.samples.length,
            persistenceState: session.persistenceState,
            config: session.config,
            deviceInfo: session.deviceInfo,
            events: session.events
        };
    }

    private async loadSessionFromJournal(
        sessionId: string
    ): Promise<SessionDetail> {
        const metadataPath = this.getSessionJournalMetaPath(sessionId);
        const samplesPath = this.getSessionJournalSamplesPath(sessionId);
        const [metadataRaw, samplesRaw] = await Promise.all([
            fs.readFile(metadataPath, "utf8"),
            fs.readFile(samplesPath, "utf8")
        ]);

        const metadata = JSON.parse(metadataRaw) as SessionJournalMetadata;
        const samples = samplesRaw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line) as MonitorSample);

        return this.normalizeSession({
            id: metadata.id,
            serial: metadata.serial,
            packageName: metadata.packageName,
            displayName: metadata.displayName,
            startedAt: metadata.startedAt,
            endedAt: metadata.endedAt,
            sampleCount: metadata.sampleCount,
            persistenceState: "recovered",
            config: metadata.config,
            deviceInfo: metadata.deviceInfo,
            samples,
            events: metadata.events
        });
    }

    private async deleteSessionJournal(sessionId: string): Promise<void> {
        await fs.rm(this.getSessionJournalDir(sessionId), {
            force: true,
            recursive: true
        });
    }

    private getExportDir(sessionId: string): string {
        return path.join(this.exportsDir, sessionId);
    }

    private getSessionJournalDir(sessionId: string): string {
        return path.join(this.journalsDir, sessionId);
    }

    private getSessionJournalMetaPath(sessionId: string): string {
        return path.join(this.getSessionJournalDir(sessionId), "meta.json");
    }

    private getSessionJournalSamplesPath(sessionId: string): string {
        return path.join(
            this.getSessionJournalDir(sessionId),
            "samples.ndjson"
        );
    }

    private getSessionFilePath(sessionId: string): string {
        return path.join(this.sessionsDir, `${sessionId}.json`);
    }
}
