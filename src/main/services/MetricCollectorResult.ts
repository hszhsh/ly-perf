import type {
    FpsDebugInfo,
    MetricCapabilityReport,
    MetricDatum,
    MetricSnapshot
} from "@shared/types";
import type { CpuMetricResult } from "@main/services/MetricCollectorCpu";
import type { FpsAggregationResult } from "@main/services/MetricCollectorFpsAggregator";
import type { GpuResult } from "@main/services/MetricCollectorGpu";
import type {
    DiskSnapshot,
    NetworkSnapshot
} from "@main/services/MetricCollectorIo";
import type { MemoryMetricResult } from "@main/services/MetricCollectorMemory";
import type { PowerResult } from "@main/services/MetricCollectorPower";
import type { CounterSnapshot } from "@main/services/MetricCollectorState";

export interface MetricCollectResult {
    metrics: MetricSnapshot;
    fpsDebug: FpsDebugInfo;
    capabilityReport: MetricCapabilityReport;
}

export function buildCounterSnapshot(params: {
    timestamp: number;
    networkSnapshot: NetworkSnapshot;
    diskSnapshot: DiskSnapshot;
    cpuResult: CpuMetricResult;
    fpsResult: FpsAggregationResult;
    powerResult: PowerResult;
}): CounterSnapshot {
    return {
        timestamp: params.timestamp,
        rxBytes: params.networkSnapshot.rxBytes,
        txBytes: params.networkSnapshot.txBytes,
        networkTotalBytes: params.networkSnapshot.totalBytes,
        networkInterfaces: params.networkSnapshot.interfaces,
        readBytes: params.diskSnapshot.readBytes,
        writeBytes: params.diskSnapshot.writeBytes,
        cpuTotalTicks: params.cpuResult.cpuTotalTicks,
        cpuIdleTicks: params.cpuResult.cpuIdleTicks,
        cpuProcessTicks: params.cpuResult.cpuProcessTicks,
        frameCount: params.fpsResult.frameCount,
        gfxLastFrameCompletedNs: params.fpsResult.gfxLastFrameCompletedNs,
        sfLastPresentNs: params.fpsResult.sfLastPresentNs,
        sfLayerName: params.fpsResult.sfLayerName,
        batteryChargeUah: params.powerResult.chargeUah
    };
}

export function buildCapabilityReport(params: {
    serial: string;
    packageName: string;
    updatedAt: number;
    fpsDebug: FpsDebugInfo;
    gpuResult: GpuResult;
    powerResult: PowerResult;
}): MetricCapabilityReport {
    return {
        serial: params.serial,
        packageName: params.packageName,
        updatedAt: params.updatedAt,
        fps: params.fpsDebug,
        gpu: params.gpuResult.group,
        power: params.powerResult.group
    };
}

export function buildMetricCollectResult(params: {
    fpsResult: FpsAggregationResult;
    cpuResult: CpuMetricResult;
    memoryMetrics: MemoryMetricResult;
    networkRxMetric: MetricDatum;
    networkTxMetric: MetricDatum;
    networkTotalMetric: MetricDatum;
    diskReadMetric: MetricDatum;
    diskWriteMetric: MetricDatum;
    gpuResult: GpuResult;
    powerResult: PowerResult;
    temperatureMetric: MetricDatum;
    capabilityReport: MetricCapabilityReport;
}): MetricCollectResult {
    return {
        metrics: {
            fps: params.fpsResult.datum,
            jank: params.fpsResult.jankDatum,
            bigJank: params.fpsResult.bigJankDatum,
            cpu: params.cpuResult.appDatum,
            cpuTotal: params.cpuResult.totalDatum,
            memory: params.memoryMetrics.totalPss,
            memoryGraphics: params.memoryMetrics.graphics,
            memoryNativeHeap: params.memoryMetrics.nativeHeap,
            memoryPrivateOther: params.memoryMetrics.privateOther,
            networkRx: params.networkRxMetric,
            networkTx: params.networkTxMetric,
            networkTotal: params.networkTotalMetric,
            diskRead: params.diskReadMetric,
            diskWrite: params.diskWriteMetric,
            gpu: params.gpuResult.datum,
            power: params.powerResult.datum,
            temperature: params.temperatureMetric
        },
        fpsDebug: params.fpsResult.debug,
        capabilityReport: params.capabilityReport
    };
}
