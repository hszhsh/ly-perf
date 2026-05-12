import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/ipc";
import type { ExportResult, LyPerfApi, MonitorConfig, MonitorSample, SessionDetail, SessionSummary } from "@shared/types";

const api: LyPerfApi = {
  getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeInfo),
  listDevices: () => ipcRenderer.invoke(IPC_CHANNELS.listDevices),
  getDeviceInfo: (serial: string) => ipcRenderer.invoke(IPC_CHANNELS.getDeviceInfo, serial),
  listInstalledApps: (serial: string, keyword?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listInstalledApps, serial, keyword),
  readScreenshotDataUrl: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.readScreenshotDataUrl, filePath),
  startMonitor: (config: MonitorConfig) => ipcRenderer.invoke(IPC_CHANNELS.startMonitor, config),
  stopMonitor: () => ipcRenderer.invoke(IPC_CHANNELS.stopMonitor),
  getMonitorState: () => ipcRenderer.invoke(IPC_CHANNELS.getMonitorState),
  getMonitorCapabilityReport: () => ipcRenderer.invoke(IPC_CHANNELS.getMonitorCapabilityReport),
  onMonitorSample: (handler: (sample: MonitorSample) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, sample: MonitorSample) => {
      handler(sample);
    };

    ipcRenderer.on(IPC_CHANNELS.monitorSample, wrapped);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.monitorSample, wrapped);
    };
  },
  listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.listSessions) as Promise<SessionSummary[]>,
  getSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.getSession, sessionId) as Promise<SessionDetail>,
  renameSession: (sessionId: string, displayName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameSession, sessionId, displayName) as Promise<SessionDetail>,
  deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteSession, sessionId) as Promise<void>,
  exportSession: (sessionId: string, format: "html" | "xlsx") =>
    ipcRenderer.invoke(IPC_CHANNELS.exportSession, sessionId, format) as Promise<ExportResult>
};

contextBridge.exposeInMainWorld("lyPerf", api);
