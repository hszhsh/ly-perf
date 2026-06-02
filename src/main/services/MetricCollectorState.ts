import type { MetricCapabilityReport } from "@shared/types";
import type { NetworkInterfaceSnapshot } from "@main/services/MetricCollectorIo";

export interface CounterSnapshot {
    timestamp: number;
    rxBytes: number;
    txBytes: number;
    networkTotalBytes: number;
    networkInterfaces: Record<string, NetworkInterfaceSnapshot>;
    readBytes: number;
    writeBytes: number;
    cpuTotalTicks: number | null;
    cpuIdleTicks: number | null;
    cpuProcessTicks: number | null;
    frameCount: number | null;
    gfxLastFrameCompletedNs: number | null;
    sfLastPresentNs: number | null;
    sfLayerName: string | null;
    batteryChargeUah: number | null;
}

export interface SurfaceFlingerLockState {
    lockedLayer: string | null;
    pendingLayer: string | null;
    pendingCount: number;
    lastSwitchAt: number;
    lockedLayerFailureCount: number;
    timelineLayer: string | null;
    timelineNs: number[];
    timelineNeedsClear: boolean;
    timelinePrimed: boolean;
}

export class MetricCollectorStateStore {
    private readonly previous = new Map<string, CounterSnapshot>();
    private readonly capabilityReports = new Map<
        string,
        MetricCapabilityReport
    >();
    private readonly sfLockStates = new Map<string, SurfaceFlingerLockState>();

    buildKey(serial: string, packageName: string): string {
        return `${serial}::${packageName}`;
    }

    reset(serial: string, packageName: string): void {
        const key = this.buildKey(serial, packageName);

        this.previous.delete(key);
        this.capabilityReports.delete(key);
        this.sfLockStates.delete(key);
    }

    getPrevious(key: string): CounterSnapshot | undefined {
        return this.previous.get(key);
    }

    setPrevious(key: string, snapshot: CounterSnapshot): void {
        this.previous.set(key, snapshot);
    }

    clearSurfaceFlingerLock(key: string): void {
        this.sfLockStates.delete(key);
    }

    getSurfaceFlingerLock(key: string): SurfaceFlingerLockState | undefined {
        return this.sfLockStates.get(key);
    }

    setSurfaceFlingerLock(key: string, state: SurfaceFlingerLockState): void {
        this.sfLockStates.set(key, state);
    }

    getCapabilityReport(
        serial: string,
        packageName: string
    ): MetricCapabilityReport | null {
        const report = this.capabilityReports.get(
            this.buildKey(serial, packageName)
        );
        return report ?? null;
    }

    setCapabilityReport(key: string, report: MetricCapabilityReport): void {
        this.capabilityReports.set(key, report);
    }
}
