import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type {
    DeleteSessionsResult,
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

interface SessionJournalMetadata extends Omit<
    SessionDetail,
    "samples" | "customSamples"
> {
    sampleCount: number;
}

const SESSION_INDEX_VERSION = 1;
const SESSION_SUMMARY_HEADER_CHUNK_BYTES = 64 * 1024;
const SESSION_SUMMARY_HEADER_MAX_BYTES = 1024 * 1024;
const SESSION_INDEX_SCAN_CONCURRENCY = 16;

interface SessionIndexFingerprint {
    size: number;
    mtimeMs: number;
}

interface SessionIndexEntry {
    source: "session" | "journal";
    summary: SessionSummary;
    fingerprint: SessionIndexFingerprint;
}

interface SessionIndex {
    version: number;
    entries: Record<string, SessionIndexEntry>;
}

function isValidEventType(
    value: string | undefined
): value is SessionTimelineEvent["type"] {
    return (
        value === "note" ||
        value === "action" ||
        value === "issue" ||
        value === "screenshot"
    );
}

export class SessionStore {
    private readonly sessionsDir: string;
    private readonly screenshotsDir: string;
    private readonly exportsDir: string;
    private readonly journalsDir: string;
    private readonly sessionIndexPath: string;
    private sessionIndex: SessionIndex | undefined;
    private sessionIndexLoadPromise: Promise<SessionIndex> | null = null;
    private listSessionsPromise: Promise<SessionSummary[]> | null = null;
    private sessionIndexMutationChain: Promise<void> = Promise.resolve();
    private sessionIndexWriteChain: Promise<void> = Promise.resolve();

    constructor(private readonly dataDir: string) {
        this.sessionsDir = path.join(this.dataDir, "sessions");
        this.screenshotsDir = path.join(this.dataDir, "screenshots");
        this.exportsDir = path.join(this.dataDir, "exports");
        this.journalsDir = path.join(this.dataDir, "journals");
        this.sessionIndexPath = path.join(this.dataDir, "session-index.json");
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
        await fs.writeFile(
            this.getSessionJournalCustomSamplesPath(normalized.id),
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

    async appendCustomSamples(
        sessionId: string,
        samples: NonNullable<SessionDetail["customSamples"]>
    ): Promise<void> {
        if (samples.length === 0) {
            return;
        }

        const journalPath = this.getSessionJournalCustomSamplesPath(sessionId);

        await fs.mkdir(this.getSessionJournalDir(sessionId), {
            recursive: true
        });
        await fs.appendFile(
            journalPath,
            samples.map((sample) => JSON.stringify(sample)).join("\n") + "\n",
            "utf8"
        );
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
        await this.removeSessionIndexEntry(
            this.getSessionIndexKey("journal", session.id)
        );
    }

    async saveSession(session: SessionDetail): Promise<void> {
        const normalized = this.normalizeSession(session);

        await fs.mkdir(this.sessionsDir, { recursive: true });
        const sessionPath = this.getSessionFilePath(normalized.id);
        await fs.writeFile(
            sessionPath,
            JSON.stringify(normalized, null, 2),
            "utf8"
        );
        await this.upsertSessionIndexEntry(
            this.getSessionIndexKey("session", normalized.id),
            sessionPath,
            this.toSessionSummary(normalized)
        );
    }

    async listSessions(): Promise<SessionSummary[]> {
        if (this.listSessionsPromise) {
            return this.listSessionsPromise;
        }

        const pending = this.listSessionsInternal();
        this.listSessionsPromise = pending;

        try {
            return await pending;
        } finally {
            if (this.listSessionsPromise === pending) {
                this.listSessionsPromise = null;
            }
        }
    }

    private async listSessionsInternal(): Promise<SessionSummary[]> {
        await fs.mkdir(this.sessionsDir, { recursive: true });
        await fs.mkdir(this.journalsDir, { recursive: true });

        const [files, journalEntries, index] = await Promise.all([
            fs.readdir(this.sessionsDir, { withFileTypes: true }),
            fs.readdir(this.journalsDir, { withFileTypes: true }),
            this.loadSessionIndex()
        ]);
        const sessions: SessionSummary[] = [];
        const formalSessionIds = new Set<string>();
        const nextEntries: Record<string, SessionIndexEntry> = {};

        const sessionResults = await this.mapWithConcurrency(
            files.filter(
                (file) => file.isFile() && file.name.endsWith(".json")
            ),
            SESSION_INDEX_SCAN_CONCURRENCY,
            async (file) => {
                const filePath = path.join(this.sessionsDir, file.name);
                const key = this.getSessionIndexKey(
                    "session",
                    file.name.slice(0, -5)
                );

                try {
                    const fingerprint = await this.getFileFingerprint(filePath);
                    const cached = index.entries[key];
                    const summary =
                        cached &&
                        this.hasMatchingFingerprint(cached, fingerprint)
                            ? cached.summary
                            : await this.readSessionSummary(filePath);

                    return {
                        key,
                        summary,
                        fingerprint
                    };
                } catch (error) {
                    console.warn(
                        `Skip invalid session file ${filePath}:`,
                        error
                    );
                    return null;
                }
            }
        );

        for (const result of sessionResults) {
            if (!result) {
                continue;
            }

            nextEntries[result.key] = {
                source: "session",
                summary: result.summary,
                fingerprint: result.fingerprint
            };
            sessions.push(result.summary);
            formalSessionIds.add(result.summary.id);
        }

        const journalResults = await this.mapWithConcurrency(
            journalEntries.filter(
                (entry) =>
                    entry.isDirectory() && !formalSessionIds.has(entry.name)
            ),
            SESSION_INDEX_SCAN_CONCURRENCY,
            async (entry) => {
                const metadataPath = this.getSessionJournalMetaPath(entry.name);
                const key = this.getSessionIndexKey("journal", entry.name);

                try {
                    const fingerprint =
                        await this.getFileFingerprint(metadataPath);
                    const cached = index.entries[key];
                    const summary =
                        cached &&
                        this.hasMatchingFingerprint(cached, fingerprint)
                            ? cached.summary
                            : await this.readJournalSummary(metadataPath);

                    return {
                        key,
                        summary,
                        fingerprint
                    };
                } catch (error) {
                    console.warn(
                        `Skip invalid session journal ${entry.name}:`,
                        error
                    );
                    return null;
                }
            }
        );

        for (const result of journalResults) {
            if (!result) {
                continue;
            }

            nextEntries[result.key] = {
                source: "journal",
                summary: result.summary,
                fingerprint: result.fingerprint
            };
            sessions.push(result.summary);
        }

        await this.withSessionIndexMutation(async () => {
            const currentIndex = await this.loadSessionIndex();
            const mergedEntries = { ...currentIndex.entries };
            const keys = new Set([
                ...Object.keys(index.entries),
                ...Object.keys(currentIndex.entries),
                ...Object.keys(nextEntries)
            ]);

            for (const key of keys) {
                const baselineEntry = index.entries[key];
                const currentEntry = currentIndex.entries[key];

                // A mutation that ran after the scan owns this key. Do not
                // restore a stale scan result over it.
                if (currentEntry !== baselineEntry) {
                    continue;
                }

                const scannedEntry = nextEntries[key];
                if (scannedEntry) {
                    mergedEntries[key] = scannedEntry;
                } else {
                    delete mergedEntries[key];
                }
            }

            const mergedIndex: SessionIndex = {
                version: SESSION_INDEX_VERSION,
                entries: this.sortSessionIndexEntries(mergedEntries)
            };
            this.sessionIndex = mergedIndex;

            if (JSON.stringify(currentIndex) !== JSON.stringify(mergedIndex)) {
                try {
                    await this.persistSessionIndex(mergedIndex);
                } catch (error) {
                    console.warn(
                        "Unable to persist session summary index:",
                        error
                    );
                }
            }
        });

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
        const type = this.normalizeEventType(input.type);
        const text = this.normalizeEventText(input.text, type);
        const color = this.normalizeEventColor(input.color);
        const screenshotPath = this.normalizeEventScreenshotPath(
            input.screenshotPath,
            type === "screenshot"
        );
        const now = Date.now();
        const nextEvent: SessionTimelineEvent = {
            id: randomUUID(),
            timestamp,
            type,
            color,
            text,
            screenshotPath,
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

        const existingEvent = session.events.find(
            (event) => event.id === eventId
        );
        if (!existingEvent) {
            throw new Error("未找到要更新的事件。");
        }

        const timestamp = this.normalizeEventTimestamp(input.timestamp);
        const type =
            existingEvent.type === "screenshot"
                ? "screenshot"
                : this.normalizeEventType(input.type);
        const text = this.normalizeEventText(input.text, type);
        const color = this.normalizeEventColor(input.color);
        const screenshotPath = this.normalizeEventScreenshotPath(
            input.screenshotPath ?? existingEvent.screenshotPath,
            type === "screenshot"
        );
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
                          screenshotPath,
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
        await this.removeSessionIndexEntry(
            this.getSessionIndexKey("session", sessionId)
        );
        await this.removeSessionIndexEntry(
            this.getSessionIndexKey("journal", sessionId)
        );
    }

    async deleteSessions(sessionIds: string[]): Promise<DeleteSessionsResult> {
        if (!Array.isArray(sessionIds)) {
            throw new Error("批量删除参数无效。");
        }

        const uniqueSessionIds = Array.from(
            new Set(sessionIds.map((sessionId) => sessionId.trim()))
        ).filter(Boolean);
        const results = await this.mapWithConcurrency(
            uniqueSessionIds,
            4,
            async (sessionId) => {
                try {
                    await this.deleteSessionArtifactsWithoutLoading(sessionId);
                    return { sessionId, deleted: true as const };
                } catch (error) {
                    return {
                        sessionId,
                        deleted: false as const,
                        message:
                            error instanceof Error && error.message
                                ? error.message
                                : "删除历史会话失败。"
                    };
                }
            }
        );
        const deletedIds = results
            .filter((result) => result.deleted)
            .map((result) => result.sessionId);
        const failures = results
            .filter((result) => !result.deleted)
            .map((result) => ({
                sessionId: result.sessionId,
                message: result.message
            }));

        await this.removeSessionIndexEntries(
            deletedIds.flatMap((sessionId) => [
                this.getSessionIndexKey("session", sessionId),
                this.getSessionIndexKey("journal", sessionId)
            ])
        );

        return { deletedIds, failures };
    }

    private async deleteSessionArtifactsWithoutLoading(
        sessionId: string
    ): Promise<void> {
        if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
            throw new Error("历史会话 ID 无效。");
        }

        const [hasSessionFile, hasJournal] = await Promise.all([
            this.pathExists(this.getSessionFilePath(sessionId)),
            this.pathExists(this.getSessionJournalMetaPath(sessionId))
        ]);
        if (!hasSessionFile && !hasJournal) {
            throw new Error("未找到历史会话。");
        }

        await Promise.all([
            fs.rm(this.getSessionFilePath(sessionId), { force: true }),
            fs.rm(this.getScreenshotDir(sessionId), {
                force: true,
                recursive: true
            }),
            fs.rm(this.getExportDir(sessionId), {
                force: true,
                recursive: true
            }),
            this.deleteSessionJournal(sessionId)
        ]);
    }

    private async pathExists(targetPath: string): Promise<boolean> {
        try {
            await fs.stat(targetPath);
            return true;
        } catch (error) {
            if (
                (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
            ) {
                return false;
            }

            throw error;
        }
    }

    private async loadSessionIndex(): Promise<SessionIndex> {
        if (this.sessionIndex) {
            return this.sessionIndex;
        }

        if (!this.sessionIndexLoadPromise) {
            this.sessionIndexLoadPromise = (async () => {
                let index: SessionIndex = {
                    version: SESSION_INDEX_VERSION,
                    entries: {}
                };

                try {
                    const content = await fs.readFile(
                        this.sessionIndexPath,
                        "utf8"
                    );
                    const parsed = JSON.parse(content) as unknown;
                    const parsedIndex = this.parseSessionIndex(parsed);
                    if (parsedIndex) {
                        index = parsedIndex;
                    }
                } catch (error) {
                    if (
                        (error as NodeJS.ErrnoException | undefined)?.code !==
                        "ENOENT"
                    ) {
                        console.warn(
                            "Unable to read session summary index:",
                            error
                        );
                    }
                }

                this.sessionIndex = index;
                return index;
            })();
        }

        const pending = this.sessionIndexLoadPromise;
        try {
            return await pending;
        } finally {
            if (this.sessionIndexLoadPromise === pending) {
                this.sessionIndexLoadPromise = null;
            }
        }
    }

    private parseSessionIndex(value: unknown): SessionIndex | null {
        if (!value || typeof value !== "object") {
            return null;
        }

        const candidate = value as {
            version?: unknown;
            entries?: unknown;
        };
        if (candidate.version !== SESSION_INDEX_VERSION) {
            return null;
        }
        if (!candidate.entries || typeof candidate.entries !== "object") {
            return null;
        }

        const entries: Record<string, SessionIndexEntry> = {};
        for (const [key, rawEntry] of Object.entries(
            candidate.entries as Record<string, unknown>
        )) {
            if (!rawEntry || typeof rawEntry !== "object") {
                continue;
            }

            const entry = rawEntry as {
                source?: unknown;
                summary?: unknown;
                fingerprint?: unknown;
            };
            const summary = this.toSessionSummaryFromRecord(
                entry.summary as Partial<SessionDetail> | undefined
            );
            const fingerprint = entry.fingerprint as {
                size?: unknown;
                mtimeMs?: unknown;
            };
            if (
                (entry.source !== "session" && entry.source !== "journal") ||
                !summary ||
                !key.startsWith(`${entry.source}:`) ||
                !key.slice(entry.source.length + 1) ||
                !fingerprint ||
                typeof fingerprint.size !== "number" ||
                !Number.isFinite(fingerprint.size) ||
                typeof fingerprint.mtimeMs !== "number" ||
                !Number.isFinite(fingerprint.mtimeMs)
            ) {
                continue;
            }

            entries[key] = {
                source: entry.source,
                summary,
                fingerprint: {
                    size: fingerprint.size,
                    mtimeMs: fingerprint.mtimeMs
                }
            };
        }

        return {
            version: SESSION_INDEX_VERSION,
            entries
        };
    }

    private async persistSessionIndex(index: SessionIndex): Promise<void> {
        const operation = this.sessionIndexWriteChain.then(async () => {
            await fs.mkdir(this.dataDir, { recursive: true });
            const temporaryPath = `${this.sessionIndexPath}.${process.pid}.${Date.now()}.tmp`;
            try {
                await fs.writeFile(
                    temporaryPath,
                    JSON.stringify(index, null, 2),
                    "utf8"
                );
                await fs.rename(temporaryPath, this.sessionIndexPath);
            } catch (error) {
                await fs.rm(temporaryPath, { force: true }).catch(() => {
                    // Preserve the original write or rename failure.
                });
                throw error;
            }
        });

        this.sessionIndexWriteChain = operation.catch(() => undefined);
        await operation;
    }

    private async upsertSessionIndexEntry(
        key: string,
        sourcePath: string,
        summary: SessionSummary
    ): Promise<void> {
        await this.withSessionIndexMutation(async () => {
            try {
                const fingerprint = await this.getFileFingerprint(sourcePath);
                const index = await this.loadSessionIndex();
                const existing = index.entries[key];
                if (
                    existing &&
                    this.hasMatchingFingerprint(existing, fingerprint) &&
                    JSON.stringify(existing.summary) === JSON.stringify(summary)
                ) {
                    return;
                }

                const nextIndex: SessionIndex = {
                    version: SESSION_INDEX_VERSION,
                    entries: this.sortSessionIndexEntries({
                        ...index.entries,
                        [key]: {
                            source: this.getSessionIndexSource(key),
                            summary,
                            fingerprint
                        }
                    })
                };
                this.sessionIndex = nextIndex;
                await this.persistSessionIndex(nextIndex);
            } catch (error) {
                console.warn("Unable to persist session summary index:", error);
            }
        });
    }

    private async removeSessionIndexEntry(key: string): Promise<void> {
        await this.removeSessionIndexEntries([key]);
    }

    private async removeSessionIndexEntries(keys: string[]): Promise<void> {
        if (keys.length === 0) {
            return;
        }

        await this.withSessionIndexMutation(async () => {
            const index = await this.loadSessionIndex();
            if (!keys.some((key) => index.entries[key])) {
                return;
            }

            const entries = { ...index.entries };
            for (const key of keys) {
                delete entries[key];
            }
            const nextIndex: SessionIndex = {
                version: SESSION_INDEX_VERSION,
                entries: this.sortSessionIndexEntries(entries)
            };
            this.sessionIndex = nextIndex;

            try {
                await this.persistSessionIndex(nextIndex);
            } catch (error) {
                console.warn("Unable to persist session summary index:", error);
            }
        });
    }

    private async withSessionIndexMutation<T>(
        operation: () => Promise<T>
    ): Promise<T> {
        const task = this.sessionIndexMutationChain.then(operation);
        this.sessionIndexMutationChain = task.then(
            () => undefined,
            () => undefined
        );
        return task;
    }

    private async mapWithConcurrency<T, R>(
        items: T[],
        concurrency: number,
        mapper: (item: T) => Promise<R>
    ): Promise<R[]> {
        const results = new Array<R>(items.length);
        let nextIndex = 0;
        const workerCount = Math.min(concurrency, items.length);

        const worker = async (): Promise<void> => {
            while (nextIndex < items.length) {
                const index = nextIndex;
                nextIndex += 1;
                results[index] = await mapper(items[index]);
            }
        };

        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return results;
    }

    private sortSessionIndexEntries(
        entries: Record<string, SessionIndexEntry>
    ): Record<string, SessionIndexEntry> {
        return Object.fromEntries(
            Object.entries(entries).sort(([left], [right]) =>
                left.localeCompare(right)
            )
        );
    }

    private getSessionIndexKey(
        source: "session" | "journal",
        id: string
    ): string {
        return `${source}:${id}`;
    }

    private getSessionIndexSource(key: string): "session" | "journal" {
        return key.startsWith("journal:") ? "journal" : "session";
    }

    private async getFileFingerprint(
        filePath: string
    ): Promise<SessionIndexFingerprint> {
        const stats = await fs.stat(filePath);
        return {
            size: stats.size,
            mtimeMs: stats.mtimeMs
        };
    }

    private hasMatchingFingerprint(
        entry: SessionIndexEntry,
        fingerprint: SessionIndexFingerprint
    ): boolean {
        return (
            entry.fingerprint.size === fingerprint.size &&
            entry.fingerprint.mtimeMs === fingerprint.mtimeMs
        );
    }

    private async readSessionSummary(
        filePath: string
    ): Promise<SessionSummary> {
        const fastSummary = await this.tryReadSessionSummaryHeader(filePath);
        if (fastSummary) {
            return fastSummary;
        }

        const content = await fs.readFile(filePath, "utf8");
        const parsed = this.normalizeSession(
            JSON.parse(content) as SessionDetail
        );
        return this.toSessionSummary(parsed);
    }

    private async tryReadSessionSummaryHeader(
        filePath: string
    ): Promise<SessionSummary | null> {
        const handle = await fs.open(filePath, "r");
        const decoder = new StringDecoder("utf8");
        const buffer = Buffer.alloc(SESSION_SUMMARY_HEADER_CHUNK_BYTES);
        let content = "";
        let bytesReadTotal = 0;

        try {
            while (bytesReadTotal < SESSION_SUMMARY_HEADER_MAX_BYTES) {
                const { bytesRead } = await handle.read(
                    buffer,
                    0,
                    buffer.length,
                    bytesReadTotal
                );
                if (bytesRead === 0) {
                    break;
                }

                bytesReadTotal += bytesRead;
                content += decoder.write(buffer.subarray(0, bytesRead));
                const markerIndex = content.indexOf('\n  "config":');
                if (markerIndex < 0) {
                    continue;
                }

                const syntheticHeader = `${content.slice(0, markerIndex + 1)}  "config": {\n  }\n}`;
                try {
                    const parsed = JSON.parse(
                        syntheticHeader
                    ) as Partial<SessionDetail>;
                    return this.toSessionSummaryFromRecord(parsed);
                } catch {
                    return null;
                }
            }

            return null;
        } finally {
            decoder.end();
            await handle.close();
        }
    }

    private async readJournalSummary(
        metadataPath: string
    ): Promise<SessionSummary> {
        const content = await fs.readFile(metadataPath, "utf8");
        const parsed = JSON.parse(content) as Partial<SessionJournalMetadata>;
        const summary = this.toSessionSummaryFromRecord(parsed, "recovered");
        if (!summary) {
            throw new Error("Invalid session journal metadata.");
        }

        return summary;
    }

    private toSessionSummaryFromRecord(
        session: Partial<SessionDetail> | undefined,
        persistenceState?: SessionPersistenceState
    ): SessionSummary | null {
        if (
            !session ||
            typeof session.id !== "string" ||
            !session.id ||
            typeof session.serial !== "string" ||
            typeof session.packageName !== "string" ||
            typeof session.displayName !== "string" ||
            typeof session.startedAt !== "number" ||
            !Number.isFinite(session.startedAt) ||
            (session.endedAt !== undefined &&
                (typeof session.endedAt !== "number" ||
                    !Number.isFinite(session.endedAt))) ||
            typeof session.sampleCount !== "number" ||
            !Number.isFinite(session.sampleCount) ||
            session.sampleCount < 0
        ) {
            return null;
        }

        return {
            id: session.id,
            serial: session.serial,
            packageName: session.packageName,
            displayName: session.displayName.trim() || session.packageName,
            startedAt: session.startedAt,
            endedAt: session.endedAt || Date.now(),
            sampleCount: Math.floor(session.sampleCount),
            persistenceState:
                persistenceState ??
                (session.persistenceState === "recovered"
                    ? "recovered"
                    : "finalized")
        };
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
            events: this.normalizeEvents(session.events),
            customMetricDefinitions: Array.isArray(
                session.customMetricDefinitions
            )
                ? session.customMetricDefinitions
                : [],
            customChartDefinitions: Array.isArray(
                session.customChartDefinitions
            )
                ? session.customChartDefinitions
                : [],
            customSchemaHistory: Array.isArray(session.customSchemaHistory)
                ? session.customSchemaHistory
                : [],
            customSamples: Array.isArray(session.customSamples)
                ? session.customSamples
                : []
        };
    }

    private normalizeEvents(
        events: SessionTimelineEvent[] | undefined
    ): SessionTimelineEvent[] {
        if (!Array.isArray(events)) {
            return [];
        }

        return events
            .map<SessionTimelineEvent | null>((event) => {
                const normalizedText = event?.text?.trim();
                const screenshotPath =
                    event.type === "screenshot"
                        ? this.normalizeEventScreenshotPath(
                              event.screenshotPath,
                              true
                          )
                        : this.normalizeEventScreenshotPath(
                              event.screenshotPath,
                              false
                          );
                if (
                    !event ||
                    typeof event.id !== "string" ||
                    !event.id ||
                    typeof event.timestamp !== "number" ||
                    !Number.isFinite(event.timestamp) ||
                    !isValidEventType(event.type) ||
                    typeof event.color !== "string" ||
                    !event.color ||
                    (!normalizedText && event.type !== "screenshot")
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

                const normalizedEvent: SessionTimelineEvent = {
                    id: event.id,
                    timestamp: event.timestamp,
                    type: event.type,
                    color: event.color,
                    text: normalizedText ?? "",
                    createdAt,
                    updatedAt
                };

                if (screenshotPath) {
                    normalizedEvent.screenshotPath = screenshotPath;
                }

                return normalizedEvent;
            })
            .filter((event): event is SessionTimelineEvent => event !== null)
            .sort((left, right) => left.timestamp - right.timestamp);
    }

    private normalizeEventTimestamp(timestamp: number): number {
        if (!Number.isFinite(timestamp)) {
            throw new Error("事件时间无效。");
        }

        return Math.floor(timestamp);
    }

    private normalizeEventText(
        text: string,
        type: SessionTimelineEvent["type"]
    ): string {
        const normalizedText = text?.trim() ?? "";

        if (!normalizedText && type !== "screenshot") {
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

    private normalizeEventScreenshotPath(
        screenshotPath: string | undefined,
        required: boolean
    ): string | undefined {
        const normalizedScreenshotPath = screenshotPath?.trim();

        if (!normalizedScreenshotPath) {
            if (required) {
                throw new Error("截图路径无效。");
            }

            return undefined;
        }

        if (!path.isAbsolute(normalizedScreenshotPath)) {
            if (required) {
                throw new Error("截图路径无效。");
            }

            return undefined;
        }

        return normalizedScreenshotPath;
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
            events: session.events,
            deepMonitor: session.deepMonitor,
            customMetricDefinitions: session.customMetricDefinitions,
            customChartDefinitions: session.customChartDefinitions,
            customSchemaHistory: session.customSchemaHistory
        };
    }

    private async loadSessionFromJournal(
        sessionId: string
    ): Promise<SessionDetail> {
        const metadataPath = this.getSessionJournalMetaPath(sessionId);
        const samplesPath = this.getSessionJournalSamplesPath(sessionId);
        const customSamplesPath =
            this.getSessionJournalCustomSamplesPath(sessionId);
        const [metadataRaw, samplesRaw, customSamplesRaw] = await Promise.all([
            fs.readFile(metadataPath, "utf8"),
            fs.readFile(samplesPath, "utf8"),
            fs.readFile(customSamplesPath, "utf8").catch((error) => {
                if (
                    (error as NodeJS.ErrnoException | undefined)?.code ===
                    "ENOENT"
                ) {
                    return "";
                }

                throw error;
            })
        ]);

        const metadata = JSON.parse(metadataRaw) as SessionJournalMetadata;
        const samples = samplesRaw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line) as MonitorSample);
        const customSamples = customSamplesRaw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map(
                (line) =>
                    JSON.parse(line) as NonNullable<
                        SessionDetail["customSamples"]
                    >[number]
            );

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
            events: metadata.events,
            deepMonitor: metadata.deepMonitor,
            customMetricDefinitions: metadata.customMetricDefinitions,
            customChartDefinitions: metadata.customChartDefinitions,
            customSchemaHistory: metadata.customSchemaHistory,
            customSamples
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

    private getSessionJournalCustomSamplesPath(sessionId: string): string {
        return path.join(
            this.getSessionJournalDir(sessionId),
            "custom-samples.ndjson"
        );
    }

    private getSessionFilePath(sessionId: string): string {
        return path.join(this.sessionsDir, `${sessionId}.json`);
    }
}
