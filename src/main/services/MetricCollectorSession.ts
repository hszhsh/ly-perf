import type { MetricCapabilityReport } from "@shared/types";
import type { FpsAggregationResult } from "@main/services/MetricCollectorFpsAggregator";
import type { MetricCollectorParsedResult } from "@main/services/MetricCollectorParsing";
import {
    buildCapabilityReport,
    buildCounterSnapshot
} from "@main/services/MetricCollectorResult";
import {
    CounterSnapshot,
    MetricCollectorStateStore
} from "@main/services/MetricCollectorState";

export interface MetricCollectorSessionContext {
    timestamp: number;
    key: string;
    prev: CounterSnapshot | undefined;
}

export class MetricCollectorSession {
    constructor(private readonly state: MetricCollectorStateStore) {}

    begin(serial: string, packageName: string): MetricCollectorSessionContext {
        const timestamp = Date.now();
        const key = this.state.buildKey(serial, packageName);
        const prev = this.state.getPrevious(key);

        if (!prev) {
            this.state.clearSurfaceFlingerLock(key);
        }

        return {
            timestamp,
            key,
            prev
        };
    }

    persist(params: {
        serial: string;
        packageName: string;
        context: MetricCollectorSessionContext;
        fpsResult: FpsAggregationResult;
        parsedMetrics: MetricCollectorParsedResult;
    }): MetricCapabilityReport {
        const { serial, packageName, context, fpsResult, parsedMetrics } =
            params;

        this.state.setPrevious(
            context.key,
            buildCounterSnapshot({
                timestamp: context.timestamp,
                networkSnapshot: parsedMetrics.networkSnapshot,
                diskSnapshot: parsedMetrics.diskSnapshot,
                cpuResult: parsedMetrics.cpuResult,
                fpsResult,
                powerResult: parsedMetrics.powerResult
            })
        );

        const capabilityReport = buildCapabilityReport({
            serial,
            packageName,
            updatedAt: context.timestamp,
            fpsDebug: fpsResult.debug,
            gpuResult: parsedMetrics.gpuResult,
            powerResult: parsedMetrics.powerResult
        });

        this.state.setCapabilityReport(context.key, capabilityReport);

        return capabilityReport;
    }

    reset(serial: string, packageName: string): void {
        this.state.reset(serial, packageName);
    }

    getCapabilityReport(
        serial: string,
        packageName: string
    ): MetricCapabilityReport | null {
        return this.state.getCapabilityReport(serial, packageName);
    }
}
