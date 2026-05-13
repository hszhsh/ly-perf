import path from "node:path";
import type {
    CpuUsageMode,
    FpsMode,
    MetricCapabilityReport,
    MonitorConfig,
    MonitorSample,
    MonitorState,
    SessionDetail,
    SessionTimelineEventInput,
    SessionTimelineEventUpdate
} from "@shared/types";
import { AdbClient } from "@main/adb/AdbClient";
import { DeviceService } from "@main/services/DeviceService";
import { MetricCollector } from "@main/services/MetricCollector";
import { SessionStore } from "@main/services/SessionStore";

interface ActiveMonitor {
    session: SessionDetail;
    collecting: boolean;
    screenshotCapturing: boolean;
    lastScreenshotAt: number;
    persistenceChain: Promise<void>;
    pendingScreenshotPath?: string;
    timer?: NodeJS.Timeout;
}

function normalizeInterval(value: number, fallback: number): number {
    if (!Number.isFinite(value) || value < 500) {
        return fallback;
    }

    return Math.floor(value);
}

function normalizeFpsMode(value: string | undefined): FpsMode {
    return value === "gfxinfo" ? "gfxinfo" : "surfaceflinger";
}

function normalizeCpuUsageMode(value: string | undefined): CpuUsageMode {
    return value === "normalized" ? "normalized" : "traditional";
}

export class MonitorService {
    private active?: ActiveMonitor;

    constructor(
        private readonly adb: AdbClient,
        private readonly deviceService: DeviceService,
        private readonly collector: MetricCollector,
        private readonly sessionStore: SessionStore,
        private readonly onSample: (
            sessionId: string,
            sample: MonitorSample
        ) => void
    ) {}

    async start(config: MonitorConfig): Promise<MonitorState> {
        if (this.active) {
            throw new Error("已有监控任务在运行，请先停止当前任务。");
        }

        const normalized: MonitorConfig = {
            ...config,
            fpsMode: normalizeFpsMode(config.fpsMode),
            cpuMode: normalizeCpuUsageMode(config.cpuMode),
            sampleIntervalMs: normalizeInterval(config.sampleIntervalMs, 1500),
            screenshotIntervalMs: normalizeInterval(
                config.screenshotIntervalMs,
                2000
            )
        };

        const deviceInfo = await this.deviceService.getDeviceInfo(
            normalized.serial
        );
        const session = this.sessionStore.createSession(normalized, deviceInfo);

        this.collector.reset(normalized.serial, normalized.packageName);

        await this.tryLaunchTargetApp(
            normalized.serial,
            normalized.packageName
        );
        await this.sessionStore.initializeSessionJournal(session);

        const active: ActiveMonitor = {
            session,
            collecting: false,
            screenshotCapturing: false,
            lastScreenshotAt: 0,
            persistenceChain: Promise.resolve()
        };

        this.active = active;
        await this.collectTick(active);

        active.timer = setInterval(() => {
            void this.collectTick(active);
        }, normalized.sampleIntervalMs);

        return this.getState();
    }

    async stop(): Promise<MonitorState> {
        const active = this.active;
        if (!active) {
            return { running: false };
        }

        if (active.timer) {
            clearInterval(active.timer);
        }

        await active.persistenceChain;
        active.session.endedAt = Date.now();
        await this.sessionStore.finalizeSessionJournal(active.session);
        this.active = undefined;

        return { running: false };
    }

    async createSessionEvent(
        sessionId: string,
        input: SessionTimelineEventInput
    ): Promise<SessionDetail> {
        const active = this.requireActiveSession(sessionId);
        const updated = this.sessionStore.withCreatedEvent(active.session, input);

        active.session = updated;
        await this.sessionStore.updateSessionJournalMetadata(updated);

        return updated;
    }

    async updateSessionEvent(
        sessionId: string,
        input: SessionTimelineEventUpdate
    ): Promise<SessionDetail> {
        const active = this.requireActiveSession(sessionId);
        const updated = this.sessionStore.withUpdatedEvent(active.session, input);

        active.session = updated;
        await this.sessionStore.updateSessionJournalMetadata(updated);

        return updated;
    }

    async deleteSessionEvent(
        sessionId: string,
        eventId: string
    ): Promise<SessionDetail> {
        const active = this.requireActiveSession(sessionId);
        const updated = this.sessionStore.withDeletedEvent(active.session, eventId);

        active.session = updated;
        await this.sessionStore.updateSessionJournalMetadata(updated);

        return updated;
    }

    getState(): MonitorState {
        if (!this.active) {
            return { running: false };
        }

        return {
            running: true,
            sessionId: this.active.session.id,
            config: this.active.session.config,
            startedAt: this.active.session.startedAt
        };
    }

    getCapabilityReport(): MetricCapabilityReport | null {
        const active = this.active;
        if (!active) {
            return null;
        }

        return this.collector.getCapabilityReport(
            active.session.serial,
            active.session.packageName
        );
    }

    async dispose(): Promise<void> {
        await this.stop();
    }

    private async collectTick(active: ActiveMonitor): Promise<void> {
        if (!this.active || this.active !== active || active.collecting) {
            return;
        }

        active.collecting = true;

        try {
            // Screenshot capture can take several seconds on some devices, so keep it off the metric path.
            this.captureScreenshotIfNeeded(active);
            const collected = await this.collector.collect(
                active.session.serial,
                active.session.packageName,
                active.session.config.fpsMode,
                active.session.config.cpuMode
            );
            const screenshotPath = this.consumePendingScreenshotPath(active);

            const sample: MonitorSample = {
                timestamp: Date.now(),
                metrics: collected.metrics,
                screenshotPath,
                fpsDebug: collected.fpsDebug,
                capabilityReport: collected.capabilityReport
            };

            active.session.samples.push(sample);
            active.session.endedAt = sample.timestamp;
            active.session.sampleCount = active.session.samples.length;
            this.enqueuePersistence(active, async () => {
                await this.sessionStore.appendSessionSample(
                    active.session.id,
                    sample
                );
                await this.sessionStore.updateSessionJournalMetadata(
                    active.session
                );
            });
            this.onSample(active.session.id, sample);
        } catch (error) {
            console.error("Collect monitor sample failed:", error);
        } finally {
            active.collecting = false;
        }
    }

    private requireActiveSession(sessionId: string): ActiveMonitor {
        if (!this.active || this.active.session.id !== sessionId) {
            throw new Error("目标会话当前不在实时监测中。");
        }

        return this.active;
    }

    private captureScreenshotIfNeeded(active: ActiveMonitor): void {
        const config = active.session.config;

        if (!config.screenshotEnabled || active.screenshotCapturing) {
            return;
        }

        const now = Date.now();
        if (now - active.lastScreenshotAt < config.screenshotIntervalMs) {
            return;
        }

        const screenshotDir = this.sessionStore.getScreenshotDir(
            active.session.id
        );
        const fileName = `${now}.png`;
        const screenshotPath = path.join(screenshotDir, fileName);
        active.screenshotCapturing = true;

        void this.adb
            .captureScreen(active.session.serial, screenshotPath)
            .then(() => {
                active.lastScreenshotAt = now;
                active.pendingScreenshotPath = screenshotPath;
            })
            .catch((error) => {
                console.warn("Capture screenshot failed:", error);
            })
            .finally(() => {
                active.screenshotCapturing = false;
            });
    }

    private consumePendingScreenshotPath(
        active: ActiveMonitor
    ): string | undefined {
        const screenshotPath = active.pendingScreenshotPath;
        active.pendingScreenshotPath = undefined;
        return screenshotPath;
    }

    private enqueuePersistence(
        active: ActiveMonitor,
        task: () => Promise<void>
    ): void {
        active.persistenceChain = active.persistenceChain
            .then(task, task)
            .catch((error) => {
                console.error("Persist monitor session journal failed:", error);
            });
    }

    private async tryLaunchTargetApp(
        serial: string,
        packageName: string
    ): Promise<void> {
        try {
            const launched = await this.adb.launchApp(serial, packageName);
            if (!launched) {
                console.warn(
                    `Auto launch failed for ${packageName}. User may need to manually open the app and continue monitoring.`
                );
            }
        } catch (error) {
            console.warn(`Auto launch failed for ${packageName}:`, error);
        }
    }
}
