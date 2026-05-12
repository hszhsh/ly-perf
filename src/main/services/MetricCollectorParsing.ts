import type { CpuUsageMode, MetricDatum } from "@shared/types";
import {
    parseCpuMetrics,
    type CpuMetricResult
} from "@main/services/MetricCollectorCpu";
import {
    parseGpuMetrics,
    type GpuResult
} from "@main/services/MetricCollectorGpu";
import {
    parseDiskIoMetrics,
    parseNetworkMetrics,
    type DiskSnapshot,
    type NetworkSnapshot
} from "@main/services/MetricCollectorIo";
import {
    parseMemoryMetrics,
    type MemoryMetricResult
} from "@main/services/MetricCollectorMemory";
import {
    parsePowerMetrics,
    parseTemperatureMetric,
    type PowerResult
} from "@main/services/MetricCollectorPower";
import type { MetricCollectorProbeResult } from "@main/services/MetricCollectorProbes";
import type { CounterSnapshot } from "@main/services/MetricCollectorState";

export interface MetricCollectorParsedResult {
    cpuResult: CpuMetricResult;
    memoryMetrics: MemoryMetricResult;
    networkRxMetric: MetricDatum;
    networkTxMetric: MetricDatum;
    networkTotalMetric: MetricDatum;
    networkSnapshot: NetworkSnapshot;
    diskReadMetric: MetricDatum;
    diskWriteMetric: MetricDatum;
    diskSnapshot: DiskSnapshot;
    temperatureMetric: MetricDatum;
    powerResult: PowerResult;
    gpuResult: GpuResult;
}

export function parseMetricProbeOutputs(params: {
    probeOutputs: MetricCollectorProbeResult;
    prev: CounterSnapshot | undefined;
    timestamp: number;
    cpuMode: CpuUsageMode;
}): MetricCollectorParsedResult {
    const { probeOutputs, prev, timestamp, cpuMode } = params;

    const cpuResult = parseCpuMetrics(
        probeOutputs.cpuStatInfo,
        probeOutputs.processCpuStatInfo,
        prev,
        cpuMode,
        probeOutputs.cpuFrequencyInfo
    );
    const memoryMetrics = parseMemoryMetrics(probeOutputs.memInfo);
    const [
        networkRxMetric,
        networkTxMetric,
        networkTotalMetric,
        networkSnapshot
    ] = parseNetworkMetrics(probeOutputs.netDevInfo, prev, timestamp);
    const [diskReadMetric, diskWriteMetric, diskSnapshot] = parseDiskIoMetrics(
        probeOutputs.diskStatsInfo,
        prev,
        timestamp
    );
    const temperatureMetric = parseTemperatureMetric(
        probeOutputs.powerSource.batteryInfo
    );
    const powerResult = parsePowerMetrics(
        probeOutputs.powerSource,
        prev,
        timestamp
    );
    const gpuResult = parseGpuMetrics(probeOutputs.gpuSource);

    return {
        cpuResult,
        memoryMetrics,
        networkRxMetric,
        networkTxMetric,
        networkTotalMetric,
        networkSnapshot,
        diskReadMetric,
        diskWriteMetric,
        diskSnapshot,
        temperatureMetric,
        powerResult,
        gpuResult
    };
}
