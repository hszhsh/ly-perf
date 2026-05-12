import type { FpsDebugInfo, FpsMode, MetricDatum } from "@shared/types";
import { unavailable } from "@main/services/MetricCollectorCommon";
import {
    FpsComputationResult,
    parseGfxInfoFps
} from "@main/services/MetricCollectorFps";
import type {
    SurfaceFlingerCollector,
    SurfaceFlingerResult
} from "@main/services/MetricCollectorSurfaceFlinger";
import type { CounterSnapshot } from "@main/services/MetricCollectorState";

export interface FpsAggregationResult {
    datum: MetricDatum;
    jankDatum: MetricDatum;
    bigJankDatum: MetricDatum;
    frameCount: number | null;
    gfxLastFrameCompletedNs: number | null;
    sfLastPresentNs: number | null;
    sfLayerName: string | null;
    debug: FpsDebugInfo;
}

export class MetricCollectorFpsAggregator {
    constructor(
        private readonly surfaceFlingerCollector: SurfaceFlingerCollector
    ) {}

    async collect(
        collectionKey: string,
        serial: string,
        packageName: string,
        fpsMode: FpsMode,
        gfxInfo: string,
        prev: CounterSnapshot | undefined,
        timestamp: number
    ): Promise<FpsAggregationResult> {
        const [gfxResult, sfResult] = await Promise.all([
            Promise.resolve(parseGfxInfoFps(gfxInfo, prev, timestamp)),
            this.surfaceFlingerCollector.collect(
                collectionKey,
                serial,
                packageName,
                prev,
                timestamp
            )
        ]);

        if (fpsMode === "surfaceflinger") {
            if (sfResult.datum.available) {
                return this.buildResult(
                    gfxResult,
                    sfResult,
                    sfResult.datum,
                    sfResult.jankDatum,
                    sfResult.bigJankDatum,
                    {
                        requestedMode: "surfaceflinger",
                        activeSource: "surfaceflinger",
                        fallbackUsed: false
                    }
                );
            }

            return this.buildResult(
                gfxResult,
                sfResult,
                unavailable(
                    "FPS",
                    sfResult.datum.reason ?? "SurfaceFlinger 不可用",
                    "surfaceflinger"
                ),
                sfResult.jankDatum,
                sfResult.bigJankDatum,
                {
                    requestedMode: "surfaceflinger",
                    activeSource: "none",
                    fallbackUsed: false
                }
            );
        }

        if (gfxResult.datum.available) {
            return this.buildResult(
                gfxResult,
                sfResult,
                gfxResult.datum,
                gfxResult.jankDatum,
                gfxResult.bigJankDatum,
                {
                    requestedMode: "gfxinfo",
                    activeSource: "gfxinfo",
                    fallbackUsed: false
                }
            );
        }

        if (sfResult.datum.available) {
            return this.buildResult(
                gfxResult,
                sfResult,
                {
                    ...sfResult.datum,
                    source: `${sfResult.datum.source} (gfxinfo fallback)`
                },
                sfResult.jankDatum,
                sfResult.bigJankDatum,
                {
                    requestedMode: "gfxinfo",
                    activeSource: "surfaceflinger",
                    fallbackUsed: true,
                    fallbackReason: gfxResult.datum.reason ?? "gfxinfo 不可用"
                }
            );
        }

        const combinedUnavailableReason = `${gfxResult.datum.reason ?? "gfxinfo 不可用"}; ${sfResult.datum.reason ?? "SurfaceFlinger 不可用"}`;
        const combinedJankReason = `${gfxResult.jankDatum.reason ?? "gfxinfo Jank 不可用"}; ${sfResult.jankDatum.reason ?? "SurfaceFlinger Jank 不可用"}`;

        return {
            datum: unavailable(
                "FPS",
                combinedUnavailableReason,
                "gfxinfo -> surfaceflinger"
            ),
            jankDatum: gfxResult.jankDatum.available
                ? gfxResult.jankDatum
                : sfResult.jankDatum.available
                  ? sfResult.jankDatum
                  : unavailable(
                        "count",
                        combinedJankReason,
                        "gfxinfo -> surfaceflinger"
                    ),
            bigJankDatum: gfxResult.bigJankDatum.available
                ? gfxResult.bigJankDatum
                : sfResult.bigJankDatum.available
                  ? sfResult.bigJankDatum
                  : unavailable(
                        "count",
                        combinedJankReason,
                        "gfxinfo -> surfaceflinger"
                    ),
            frameCount: gfxResult.frameCount,
            gfxLastFrameCompletedNs: gfxResult.latestFrameCompletedNs,
            sfLastPresentNs: sfResult.sfLastPresentNs,
            sfLayerName: sfResult.sfLayerName,
            debug: this.buildDebugInfo(sfResult, {
                requestedMode: "gfxinfo",
                activeSource: "none",
                fallbackUsed: true,
                fallbackReason: combinedUnavailableReason
            })
        };
    }

    private buildResult(
        gfxResult: FpsComputationResult,
        sfResult: SurfaceFlingerResult,
        datum: MetricDatum,
        jankDatum: MetricDatum,
        bigJankDatum: MetricDatum,
        debugBase: Pick<
            FpsDebugInfo,
            "requestedMode" | "activeSource" | "fallbackUsed"
        > &
            Partial<FpsDebugInfo>
    ): FpsAggregationResult {
        return {
            datum,
            jankDatum,
            bigJankDatum,
            frameCount: gfxResult.frameCount,
            gfxLastFrameCompletedNs: gfxResult.latestFrameCompletedNs,
            sfLastPresentNs: sfResult.sfLastPresentNs,
            sfLayerName: sfResult.sfLayerName,
            debug: this.buildDebugInfo(sfResult, debugBase)
        };
    }

    private buildDebugInfo(
        sfResult: SurfaceFlingerResult,
        debugBase: Pick<
            FpsDebugInfo,
            "requestedMode" | "activeSource" | "fallbackUsed"
        > &
            Partial<FpsDebugInfo>
    ): FpsDebugInfo {
        return {
            requestedMode: debugBase.requestedMode,
            activeSource: debugBase.activeSource,
            fallbackUsed: debugBase.fallbackUsed,
            fallbackReason: debugBase.fallbackReason,
            selectedLayer: sfResult.sfLayerName,
            layerSwitchReason: sfResult.layerSwitchReason,
            candidates: sfResult.candidates,
            surfaceFlingerValueMode: sfResult.valueMode,
            surfaceFlingerSampleCount: sfResult.sampleCount,
            surfaceFlingerTimelineCount: sfResult.timelineCount,
            surfaceFlingerTimelinePrimed: sfResult.timelinePrimed,
            surfaceFlingerNeedsClear: sfResult.timelineNeedsClear
        };
    }
}
