export const IPC_CHANNELS = {
    getRuntimeInfo: "runtime:get-info",
    listDevices: "device:list",
    getDeviceInfo: "device:get-info",
    listInstalledApps: "device:list-installed-apps",
    readScreenshotDataUrl: "asset:read-screenshot-data-url",
    startMonitor: "monitor:start",
    stopMonitor: "monitor:stop",
    getMonitorState: "monitor:get-state",
    getMonitorCapabilityReport: "monitor:get-capability-report",
    monitorSample: "monitor:sample",
    listSessions: "report:list-sessions",
    getSession: "report:get-session",
    renameSession: "report:rename-session",
    deleteSession: "report:delete-session",
    exportSession: "report:export-session"
} as const;
