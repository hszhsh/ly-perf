import { app, BrowserWindow } from "electron";
import path from "node:path";
import { IPC_CHANNELS } from "@shared/ipc";
import { AdbClient } from "@main/adb/AdbClient";
import { registerIpcHandlers } from "@main/ipc/registerIpc";
import { DeviceService } from "@main/services/DeviceService";
import { MetricCollector } from "@main/services/MetricCollector";
import { MonitorService } from "@main/services/MonitorService";
import { ReportService } from "@main/services/ReportService";
import { SessionStore } from "@main/services/SessionStore";

const isDev = process.env.NODE_ENV !== "production";
const devRendererUrl =
    process.env.ELECTRON_RENDERER_URL ?? "http://localhost:3173";

let mainWindow: BrowserWindow | null = null;
let monitorService: MonitorService | null = null;

function resolveAdbPath(): string {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, "adb", "win32", "adb.exe");
    }

    return path.resolve(
        app.getAppPath(),
        "resources",
        "adb",
        "win32",
        "adb.exe"
    );
}

function createMainWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: 1420,
        height: 920,
        minWidth: 1200,
        minHeight: 780,
        backgroundColor: "#111823",
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.resolve(__dirname, "preload.js")
        }
    });

    if (isDev) {
        void window.loadURL(devRendererUrl);
        window.webContents.openDevTools({ mode: "detach" });
    } else {
        void window.loadFile(path.resolve(__dirname, "../renderer/index.html"));
    }

    return window;
}

async function bootstrap(): Promise<void> {
    const adbPath = resolveAdbPath();
    const dataDir = path.join(app.getPath("userData"), "perf-data");

    const adbClient = new AdbClient(adbPath);
    const deviceService = new DeviceService(adbClient);
    const collector = new MetricCollector(adbClient);
    const sessionStore = new SessionStore(dataDir);
    await sessionStore.init();

    const reportService = new ReportService(sessionStore, app.getAppPath());
    monitorService = new MonitorService(
        adbClient,
        deviceService,
        collector,
        sessionStore,
        (_sessionId, sample) => {
            if (!mainWindow || mainWindow.isDestroyed()) {
                return;
            }

            mainWindow.webContents.send(IPC_CHANNELS.monitorSample, sample);
        }
    );

    registerIpcHandlers({
        adbPath,
        dataDir,
        appVersion: app.getVersion(),
        deviceService,
        monitorService,
        sessionStore,
        reportService
    });

    mainWindow = createMainWindow();
}

app.whenReady().then(() => {
    void bootstrap();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createMainWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("before-quit", () => {
    if (monitorService) {
        void monitorService.dispose();
    }
});
