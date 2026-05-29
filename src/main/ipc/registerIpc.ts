import fs from "node:fs/promises";
import path from "node:path";
import { ipcMain, shell } from "electron";
import { IPC_CHANNELS } from "@shared/ipc";
import type {
    MonitorConfig,
    SessionTimelineEventInput,
    SessionTimelineEventUpdate
} from "@shared/types";
import { DeviceService } from "@main/services/DeviceService";
import { MonitorService } from "@main/services/MonitorService";
import { ReportService } from "@main/services/ReportService";
import { SessionStore } from "@main/services/SessionStore";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp"
};

function toImageMimeType(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    return IMAGE_MIME_BY_EXT[ext] ?? null;
}

function isPathInside(parentPath: string, targetPath: string): boolean {
    const relativePath = path.relative(parentPath, targetPath);
    return (
        relativePath === "" ||
        (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    );
}

async function openContainingDirectory(
    dataDirPath: string,
    targetPath: string
): Promise<void> {
    if (!targetPath) {
        throw new Error("导出路径不能为空。");
    }

    const resolvedPath = path.resolve(targetPath);
    if (!isPathInside(dataDirPath, resolvedPath)) {
        throw new Error("只允许打开应用数据目录内的导出路径。");
    }

    let directoryPath = resolvedPath;

    try {
        const targetStats = await fs.stat(resolvedPath);
        if (!targetStats.isDirectory()) {
            directoryPath = path.dirname(resolvedPath);
        }
    } catch {
        directoryPath = path.dirname(resolvedPath);
    }

    const openError = await shell.openPath(directoryPath);
    if (openError) {
        throw new Error(openError);
    }
}

interface RegisterIpcDependencies {
    adbPath: string;
    dataDir: string;
    appVersion: string;
    deviceService: DeviceService;
    monitorService: MonitorService;
    sessionStore: SessionStore;
    reportService: ReportService;
}

export function registerIpcHandlers(deps: RegisterIpcDependencies): void {
    const dataDirPath = path.resolve(deps.dataDir);
    const hasActiveSession = (sessionId: string): boolean =>
        deps.monitorService.getState().sessionId === sessionId;

    ipcMain.handle(IPC_CHANNELS.getRuntimeInfo, async () => ({
        adbPath: deps.adbPath,
        dataDir: deps.dataDir,
        version: deps.appVersion
    }));

    ipcMain.handle(IPC_CHANNELS.listDevices, async () =>
        deps.deviceService.listDevices()
    );

    ipcMain.handle(IPC_CHANNELS.getDeviceInfo, async (_event, serial: string) =>
        deps.deviceService.getDeviceInfo(serial)
    );

    ipcMain.handle(
        IPC_CHANNELS.listInstalledApps,
        async (_event, serial: string, keyword?: string) =>
            deps.deviceService.listInstalledApps(serial, keyword)
    );

    ipcMain.handle(
        IPC_CHANNELS.readScreenshotDataUrl,
        async (_event, filePath: string) => {
            if (!filePath || !path.isAbsolute(filePath)) {
                return null;
            }

            const resolvedPath = path.resolve(filePath);
            if (!isPathInside(dataDirPath, resolvedPath)) {
                return null;
            }

            try {
                const mimeType = toImageMimeType(resolvedPath);
                if (!mimeType) {
                    return null;
                }

                const fileBuffer = await fs.readFile(resolvedPath);
                return `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
            } catch {
                return null;
            }
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.startMonitor,
        async (_event, config: MonitorConfig) =>
            deps.monitorService.start(config)
    );

    ipcMain.handle(IPC_CHANNELS.stopMonitor, async () =>
        deps.monitorService.stop()
    );

    ipcMain.handle(IPC_CHANNELS.getMonitorState, async () =>
        deps.monitorService.getState()
    );

    ipcMain.handle(IPC_CHANNELS.getMonitorCapabilityReport, async () =>
        deps.monitorService.getCapabilityReport()
    );

    ipcMain.handle(IPC_CHANNELS.listSessions, async () =>
        deps.sessionStore.listSessions()
    );

    ipcMain.handle(IPC_CHANNELS.getSession, async (_event, sessionId: string) =>
        deps.sessionStore.getSession(sessionId)
    );

    ipcMain.handle(
        IPC_CHANNELS.captureSessionScreenshotEvent,
        async (_event, sessionId: string) => {
            if (!hasActiveSession(sessionId)) {
                throw new Error("截图事件只能在实时监控中添加。");
            }

            return deps.monitorService.captureSessionScreenshotEvent(sessionId);
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.createSessionEvent,
        async (
            _event,
            sessionId: string,
            input: SessionTimelineEventInput
        ) => {
            if (!hasActiveSession(sessionId)) {
                throw new Error("历史报告不支持新增事件，请在实时监控时添加。");
            }

            return deps.monitorService.createSessionEvent(sessionId, input);
        }
    );

    ipcMain.handle(
        IPC_CHANNELS.updateSessionEvent,
        async (
            _event,
            sessionId: string,
            input: SessionTimelineEventUpdate
        ) =>
            hasActiveSession(sessionId)
                ? deps.monitorService.updateSessionEvent(sessionId, input)
                : deps.sessionStore.updateSessionEvent(sessionId, input)
    );

    ipcMain.handle(
        IPC_CHANNELS.deleteSessionEvent,
        async (_event, sessionId: string, eventId: string) =>
            hasActiveSession(sessionId)
                ? deps.monitorService.deleteSessionEvent(sessionId, eventId)
                : deps.sessionStore.deleteSessionEvent(sessionId, eventId)
    );

    ipcMain.handle(
        IPC_CHANNELS.renameSession,
        async (_event, sessionId: string, displayName: string) =>
            deps.sessionStore.renameSession(sessionId, displayName)
    );

    ipcMain.handle(
        IPC_CHANNELS.deleteSession,
        async (_event, sessionId: string) =>
            deps.sessionStore.deleteSession(sessionId)
    );

    ipcMain.handle(
        IPC_CHANNELS.exportSession,
        async (_event, sessionId: string, format: "html" | "xlsx" | "csv") =>
            deps.reportService.exportSession(sessionId, format)
    );

    ipcMain.handle(
        IPC_CHANNELS.openExportDirectory,
        async (_event, outputPath: string) =>
            openContainingDirectory(dataDirPath, outputPath)
    );
}
