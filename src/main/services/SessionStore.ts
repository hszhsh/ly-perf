import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DeviceInfo, MonitorConfig, SessionDetail, SessionSummary } from "@shared/types";

export class SessionStore {
  private readonly sessionsDir: string;
  private readonly screenshotsDir: string;
  private readonly exportsDir: string;

  constructor(private readonly dataDir: string) {
    this.sessionsDir = path.join(this.dataDir, "sessions");
    this.screenshotsDir = path.join(this.dataDir, "screenshots");
    this.exportsDir = path.join(this.dataDir, "exports");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.mkdir(this.screenshotsDir, { recursive: true });
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getScreenshotDir(sessionId: string): string {
    return path.join(this.screenshotsDir, sessionId);
  }

  createSession(config: MonitorConfig, deviceInfo: DeviceInfo): SessionDetail {
    const now = Date.now();

    return {
      id: randomUUID(),
      serial: config.serial,
      packageName: config.packageName,
      displayName: config.packageName,
      startedAt: now,
      endedAt: now,
      sampleCount: 0,
      config,
      deviceInfo,
      samples: []
    };
  }

  async saveSession(session: SessionDetail): Promise<void> {
    const normalized = this.normalizeSession(session);

    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.writeFile(this.getSessionFilePath(normalized.id), JSON.stringify(normalized, null, 2), "utf8");
  }

  async listSessions(): Promise<SessionSummary[]> {
    await fs.mkdir(this.sessionsDir, { recursive: true });

    const files = await fs.readdir(this.sessionsDir);
    const sessions: SessionSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(this.sessionsDir, file);

      try {
        const content = await fs.readFile(filePath, "utf8");
        const parsed = this.normalizeSession(JSON.parse(content) as SessionDetail);

        sessions.push({
          id: parsed.id,
          serial: parsed.serial,
          packageName: parsed.packageName,
          displayName: parsed.displayName,
          startedAt: parsed.startedAt,
          endedAt: parsed.endedAt,
          sampleCount: parsed.samples.length
        });
      } catch (error) {
        console.warn(`Skip invalid session file ${filePath}:`, error);
      }
    }

    return sessions.sort((a, b) => b.startedAt - a.startedAt);
  }

  async getSession(sessionId: string): Promise<SessionDetail> {
    const filePath = this.getSessionFilePath(sessionId);
    const content = await fs.readFile(filePath, "utf8");
    return this.normalizeSession(JSON.parse(content) as SessionDetail);
  }

  async renameSession(sessionId: string, displayName: string): Promise<SessionDetail> {
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
    await fs.rm(this.getScreenshotDir(sessionId), { force: true, recursive: true });
    await fs.rm(this.getExportDir(sessionId), { force: true, recursive: true });
  }

  private normalizeSession(session: SessionDetail): SessionDetail {
    return {
      ...session,
      displayName: session.displayName?.trim() || session.packageName,
      endedAt: session.endedAt || Date.now(),
      sampleCount: session.samples.length
    };
  }

  private getExportDir(sessionId: string): string {
    return path.join(this.exportsDir, sessionId);
  }

  private getSessionFilePath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }
}
