import type {
    CpuUsageMode,
    FpsMode,
    MetricCapabilityReport
} from "@shared/types";
import { AdbClient } from "@main/adb/AdbClient";
import { MetricCollectorFpsAggregator } from "@main/services/MetricCollectorFpsAggregator";
import { parseMetricProbeOutputs } from "@main/services/MetricCollectorParsing";
import { collectMetricProbeOutputs } from "@main/services/MetricCollectorProbes";
import {
    buildMetricCollectResult,
    MetricCollectResult
} from "@main/services/MetricCollectorResult";
import { MetricCollectorSession } from "@main/services/MetricCollectorSession";
import { SurfaceFlingerCollector } from "@main/services/MetricCollectorSurfaceFlinger";
import { MetricCollectorStateStore } from "@main/services/MetricCollectorState";

export class MetricCollector {
    private readonly session: MetricCollectorSession;
    private readonly fpsAggregator: MetricCollectorFpsAggregator;

    constructor(private readonly adb: AdbClient) {
        const state = new MetricCollectorStateStore();

        this.session = new MetricCollectorSession(state);
        this.fpsAggregator = new MetricCollectorFpsAggregator(
            new SurfaceFlingerCollector(adb, state)
        );
    }

    reset(serial: string, packageName: string): void {
        this.session.reset(serial, packageName);
    }

    async collect(
        serial: string,
        packageName: string,
        fpsMode: FpsMode = "surfaceflinger",
        cpuMode: CpuUsageMode = "traditional"
    ): Promise<MetricCollectResult> {
        const context = this.session.begin(serial, packageName);

        const probeOutputsPromise = collectMetricProbeOutputs(
            this.adb,
            serial,
            packageName
        );

        // Collect FPS first because SurfaceFlinger/gfxinfo are more timing-sensitive than the other shell probes.
        const gfxInfo =
            fpsMode === "gfxinfo"
                ? await this.adb.shellAllowFailure(
                      serial,
                      `dumpsys gfxinfo ${packageName}`
                  )
                : "";
        const [fpsResult, probeOutputs] = await Promise.all([
            this.fpsAggregator.collect(
                context.key,
                serial,
                packageName,
                fpsMode,
                gfxInfo,
                context.prev,
                context.timestamp
            ),
            probeOutputsPromise
        ]);

        const parsedMetrics = parseMetricProbeOutputs({
            probeOutputs,
            prev: context.prev,
            timestamp: context.timestamp,
            cpuMode
        });

        const capabilityReport = this.session.persist({
            serial,
            packageName,
            context,
            fpsResult,
            parsedMetrics
        });

        return buildMetricCollectResult({
            fpsResult,
            cpuResult: parsedMetrics.cpuResult,
            memoryMetrics: parsedMetrics.memoryMetrics,
            networkRxMetric: parsedMetrics.networkRxMetric,
            networkTxMetric: parsedMetrics.networkTxMetric,
            networkTotalMetric: parsedMetrics.networkTotalMetric,
            diskReadMetric: parsedMetrics.diskReadMetric,
            diskWriteMetric: parsedMetrics.diskWriteMetric,
            gpuResult: parsedMetrics.gpuResult,
            powerResult: parsedMetrics.powerResult,
            temperatureMetric: parsedMetrics.temperatureMetric,
            capabilityReport
        });
    }

    getCapabilityReport(
        serial: string,
        packageName: string
    ): MetricCapabilityReport | null {
        return this.session.getCapabilityReport(serial, packageName);
    }
}
