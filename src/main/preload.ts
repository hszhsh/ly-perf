import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/ipc";
import type {
    DeepMonitorSample,
    DeepMonitorSchemaRevision,
    ExportResult,
    LyPerfApi,
    MonitorConfig,
    MonitorSample,
    MonitorState,
    SessionDetail,
    SessionTimelineEventInput,
    SessionTimelineEventUpdate,
    SessionSummary
} from "@shared/types";

const api: LyPerfApi = {
    getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeInfo),
    listDevices: () => ipcRenderer.invoke(IPC_CHANNELS.listDevices),
    getDeviceInfo: (serial: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.getDeviceInfo, serial),
    listInstalledApps: (serial: string, keyword?: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.listInstalledApps, serial, keyword),
    readScreenshotDataUrl: (filePath: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.readScreenshotDataUrl, filePath),
    startMonitor: (config: MonitorConfig) =>
        ipcRenderer.invoke(IPC_CHANNELS.startMonitor, config),
    stopMonitor: () => ipcRenderer.invoke(IPC_CHANNELS.stopMonitor),
    getMonitorState: () => ipcRenderer.invoke(IPC_CHANNELS.getMonitorState),
    getMonitorCapabilityReport: () =>
        ipcRenderer.invoke(IPC_CHANNELS.getMonitorCapabilityReport),
    onMonitorStateChange: (handler: (state: MonitorState) => void) => {
        const wrapped = (
            _event: Electron.IpcRendererEvent,
            state: MonitorState
        ) => {
            handler(state);
        };

        ipcRenderer.on(IPC_CHANNELS.monitorState, wrapped);

        return () => {
            ipcRenderer.removeListener(IPC_CHANNELS.monitorState, wrapped);
        };
    },
    onMonitorCustomSchema: (
        handler: (schema: DeepMonitorSchemaRevision) => void
    ) => {
        const wrapped = (
            _event: Electron.IpcRendererEvent,
            schema: DeepMonitorSchemaRevision
        ) => {
            handler(schema);
        };

        ipcRenderer.on(IPC_CHANNELS.monitorCustomSchema, wrapped);

        return () => {
            ipcRenderer.removeListener(
                IPC_CHANNELS.monitorCustomSchema,
                wrapped
            );
        };
    },
    onMonitorCustomSamples: (handler: (samples: DeepMonitorSample[]) => void) => {
        const wrapped = (
            _event: Electron.IpcRendererEvent,
            samples: DeepMonitorSample[]
        ) => {
            handler(samples);
        };

        ipcRenderer.on(IPC_CHANNELS.monitorCustomSamples, wrapped);

        return () => {
            ipcRenderer.removeListener(
                IPC_CHANNELS.monitorCustomSamples,
                wrapped
            );
        };
    },
    onMonitorSample: (handler: (sample: MonitorSample) => void) => {
        const wrapped = (
            _event: Electron.IpcRendererEvent,
            sample: MonitorSample
        ) => {
            handler(sample);
        };

        ipcRenderer.on(IPC_CHANNELS.monitorSample, wrapped);

        return () => {
            ipcRenderer.removeListener(IPC_CHANNELS.monitorSample, wrapped);
        };
    },
    listSessions: () =>
        ipcRenderer.invoke(IPC_CHANNELS.listSessions) as Promise<
            SessionSummary[]
        >,
    getSession: (sessionId: string) =>
        ipcRenderer.invoke(
            IPC_CHANNELS.getSession,
            sessionId
        ) as Promise<SessionDetail>,
    createSessionEvent: (
        sessionId: string,
        input: SessionTimelineEventInput
    ) =>
        ipcRenderer.invoke(
            IPC_CHANNELS.createSessionEvent,
            sessionId,
            input
        ) as Promise<SessionDetail>,
    updateSessionEvent: (
        sessionId: string,
        input: SessionTimelineEventUpdate
    ) =>
        ipcRenderer.invoke(
            IPC_CHANNELS.updateSessionEvent,
            sessionId,
            input
        ) as Promise<SessionDetail>,
    deleteSessionEvent: (sessionId: string, eventId: string) =>
        ipcRenderer.invoke(
            IPC_CHANNELS.deleteSessionEvent,
            sessionId,
            eventId
        ) as Promise<SessionDetail>,
    renameSession: (sessionId: string, displayName: string) =>
        ipcRenderer.invoke(
            IPC_CHANNELS.renameSession,
            sessionId,
            displayName
        ) as Promise<SessionDetail>,
    deleteSession: (sessionId: string) =>
        ipcRenderer.invoke(
            IPC_CHANNELS.deleteSession,
            sessionId
        ) as Promise<void>,
    exportSession: (sessionId: string, format: "html" | "xlsx" | "csv") =>
        ipcRenderer.invoke(
            IPC_CHANNELS.exportSession,
            sessionId,
            format
        ) as Promise<ExportResult>,
    openExportDirectory: (outputPath: string) =>
        ipcRenderer.invoke(
            IPC_CHANNELS.openExportDirectory,
            outputPath
        ) as Promise<void>
};

contextBridge.exposeInMainWorld("lyPerf", api);
