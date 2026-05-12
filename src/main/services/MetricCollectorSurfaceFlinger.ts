import type { FpsLayerCandidate, MetricDatum } from "@shared/types";
import { AdbClient } from "@main/adb/AdbClient";
import {
    clamp,
    metric,
    round,
    shellQuote,
    unavailable,
    unavailableJankMetrics
} from "@main/services/MetricCollectorCommon";
import {
    appendCandidateIfMissing,
    computeFrameJankMetrics,
    computeSurfaceFlingerFps,
    computeSurfaceFlingerTimelineFps,
    countSurfaceFlingerNonIncreasingSteps,
    decideSurfaceFlingerLayerSwitch,
    isBetterSurfaceFlingerProbe,
    mergeSurfaceFlingerTimeline,
    parseSurfaceFlingerLayers,
    parseSurfaceFlingerLatency,
    scoreSurfaceLayer,
    sanitizeSurfaceFlingerTimeline,
    SurfaceFlingerProbeResult,
    SurfaceFlingerLatency,
    trimSurfaceFlingerTimeline
} from "@main/services/MetricCollectorFps";
import {
    CounterSnapshot,
    MetricCollectorStateStore,
    SurfaceFlingerLockState
} from "@main/services/MetricCollectorState";

export interface SurfaceFlingerResult {
    datum: MetricDatum;
    jankDatum: MetricDatum;
    bigJankDatum: MetricDatum;
    sfLastPresentNs: number | null;
    sfLayerName: string | null;
    candidates: FpsLayerCandidate[];
    layerSwitchReason?: string;
    valueMode: "warmup" | "timeline" | "snapshot" | "unavailable";
    sampleCount: number;
    timelineCount: number;
    timelinePrimed: boolean;
    timelineNeedsClear: boolean;
}

const SF_INITIAL_LOCK_CONFIRM_SAMPLES = 2;
const SF_MAX_STALE_NS = 2_000_000_000;
const SF_RESELECT_ON_LOCK_FAILURE_SAMPLES = 2;
const SF_TIMELINE_KEEP_NS = 10_000_000_000;

export class SurfaceFlingerCollector {
    constructor(
        private readonly adb: AdbClient,
        private readonly state: MetricCollectorStateStore
    ) {}

    async collect(
        collectionKey: string,
        serial: string,
        packageName: string,
        prev: CounterSnapshot | undefined,
        sampleTimestamp: number
    ): Promise<SurfaceFlingerResult> {
        const persistedLock = this.state.getSurfaceFlingerLock(collectionKey);
        const lockState: SurfaceFlingerLockState = persistedLock
            ? {
                  ...persistedLock,
                  lockedLayerFailureCount:
                      persistedLock.lockedLayerFailureCount ?? 0,
                  timelineLayer: persistedLock.timelineLayer ?? null,
                  timelineNs: sanitizeSurfaceFlingerTimeline(
                      persistedLock.timelineNs ?? []
                  ),
                  timelineNeedsClear: persistedLock.timelineNeedsClear ?? false,
                  timelinePrimed: persistedLock.timelinePrimed ?? false
              }
            : {
                  lockedLayer: prev?.sfLayerName ?? null,
                  pendingLayer: null,
                  pendingCount: 0,
                  lastSwitchAt: 0,
                  lockedLayerFailureCount: 0,
                  timelineLayer: null,
                  timelineNs: [],
                  timelineNeedsClear: false,
                  timelinePrimed: false
              };

        const buildSurfaceFlingerJankMetrics = (
            frameTimestampsNs: number[],
            layerName: string | null
        ): { jankDatum: MetricDatum; bigJankDatum: MetricDatum } => {
            const metrics = computeFrameJankMetrics(
                frameTimestampsNs,
                prev?.sfLayerName === layerName ? prev.sfLastPresentNs : null,
                layerName
                    ? `dumpsys SurfaceFlinger --latency ${layerName}`
                    : "dumpsys SurfaceFlinger --latency",
                {
                    emptyReason: "SurfaceFlinger 帧时间不足，无法计算 Jank",
                    waitingReason: "等待下一次采样计算 Jank",
                    noNewFramesReason: "SurfaceFlinger 当前采样无新增帧时间",
                    insufficientReason: "SurfaceFlinger 新增帧不足以判断 Jank"
                }
            );

            return {
                jankDatum: metrics.jankDatum,
                bigJankDatum: metrics.bigJankDatum
            };
        };

        const layerListRaw = await this.adb.shellAllowFailure(
            serial,
            "dumpsys SurfaceFlinger --list"
        );
        const layers = parseSurfaceFlingerLayers(layerListRaw);

        const rankedCandidates = layers
            .map((layer) => ({
                layer,
                score: scoreSurfaceLayer(layer, packageName),
                packageMatch: layer
                    .toLowerCase()
                    .includes(packageName.toLowerCase())
            }))
            .sort((a, b) => {
                const scoreDiff = b.score - a.score;
                if (scoreDiff !== 0) {
                    return scoreDiff;
                }

                return b.layer.length - a.layer.length;
            });

        if (lockState.lockedLayer) {
            appendCandidateIfMissing(
                rankedCandidates,
                lockState.lockedLayer,
                packageName
            );
        }

        if (prev?.sfLayerName) {
            appendCandidateIfMissing(
                rankedCandidates,
                prev.sfLayerName,
                packageName
            );
            rankedCandidates.sort((a, b) => {
                const scoreDiff = b.score - a.score;
                if (scoreDiff !== 0) {
                    return scoreDiff;
                }

                return b.layer.length - a.layer.length;
            });
        }

        if (rankedCandidates.length === 0) {
            return {
                datum: unavailable(
                    "FPS",
                    "SurfaceFlinger 未找到可用图层",
                    "dumpsys SurfaceFlinger --list"
                ),
                ...unavailableJankMetrics(
                    "SurfaceFlinger 未找到可用图层",
                    "dumpsys SurfaceFlinger --latency"
                ),
                sfLastPresentNs: prev?.sfLastPresentNs ?? null,
                sfLayerName: lockState.lockedLayer ?? prev?.sfLayerName ?? null,
                candidates: [],
                layerSwitchReason: undefined,
                valueMode: "unavailable",
                sampleCount: 0,
                timelineCount: lockState.timelineNs.length,
                timelinePrimed: lockState.timelinePrimed,
                timelineNeedsClear: lockState.timelineNeedsClear
            };
        }

        let latestPresentNs = prev?.sfLastPresentNs ?? null;

        if (lockState.lockedLayer) {
            const tried = new Set<string>([lockState.lockedLayer]);
            const lockedCandidate = rankedCandidates.find(
                (candidate) => candidate.layer === lockState.lockedLayer
            );

            if (lockState.timelineNeedsClear) {
                await this.clearSurfaceFlingerLatency(
                    serial,
                    lockState.lockedLayer
                );
                await this.waitForSurfaceFlingerWarmup();
                lockState.timelineNeedsClear = false;
                lockState.timelineLayer = lockState.lockedLayer;
                lockState.timelineNs = [];
                lockState.timelinePrimed = false;
            }

            const lockedProbe = await this.probeSurfaceFlingerLayer(
                serial,
                lockState.lockedLayer,
                prev,
                lockedCandidate?.score ?? 0,
                lockedCandidate?.packageMatch ?? false,
                lockState
            );

            if (lockedProbe) {
                const previousTimeline =
                    lockState.timelineLayer === lockState.lockedLayer
                        ? lockState.timelineNs
                        : [];
                const previousTimelineLast =
                    previousTimeline[previousTimeline.length - 1] ?? null;
                const mergeMarkerIndex =
                    previousTimelineLast !== null
                        ? lockedProbe.presentNs.indexOf(previousTimelineLast)
                        : -1;
                const mergedTimeline = mergeSurfaceFlingerTimeline(
                    previousTimeline,
                    lockedProbe.presentNs
                );
                const timelineLatestNs =
                    mergedTimeline[mergedTimeline.length - 1] ??
                    lockedProbe.currentLatestNs;
                const timelineFps =
                    computeSurfaceFlingerTimelineFps(mergedTimeline);
                const effectiveFps = timelineFps ?? lockedProbe.fpsValue;
                const previousFrameCount = prev?.frameCount ?? null;

                const suspicionReasons: string[] = [];

                if (
                    timelineFps !== null &&
                    previousFrameCount !== null &&
                    previousFrameCount >= 20 &&
                    timelineFps <= Math.max(8, previousFrameCount * 0.35)
                ) {
                    suspicionReasons.push("timeline-drop-vs-previous-sample");
                }

                if (
                    timelineFps !== null &&
                    lockedProbe.fpsValue >= 20 &&
                    timelineFps <= Math.max(8, lockedProbe.fpsValue * 0.35)
                ) {
                    suspicionReasons.push("timeline-drop-vs-current-snapshot");
                }

                if (previousTimeline.length > 0 && mergeMarkerIndex < 0) {
                    suspicionReasons.push("merge-marker-miss");
                }

                const incomingNonIncreasingSteps =
                    countSurfaceFlingerNonIncreasingSteps(
                        lockedProbe.presentNs
                    );
                const mergedNonIncreasingSteps =
                    countSurfaceFlingerNonIncreasingSteps(mergedTimeline);

                if (incomingNonIncreasingSteps > 0) {
                    suspicionReasons.push("incoming-non-monotonic");
                }

                if (mergedNonIncreasingSteps > 0) {
                    suspicionReasons.push("merged-non-monotonic");
                }

                if (suspicionReasons.length > 0) {
                    this.logSurfaceFlingerTimelineSuspicion({
                        serial,
                        layerName: lockState.lockedLayer,
                        prev,
                        lockState,
                        snapshotFps: lockedProbe.fpsValue,
                        timelineFps,
                        effectiveFps,
                        refreshHz: lockedProbe.refreshHz,
                        mergeMarkerIndex,
                        previousTimeline,
                        incomingTimeline: lockedProbe.presentNs,
                        mergedTimeline,
                        incomingNonIncreasingSteps,
                        mergedNonIncreasingSteps,
                        rawLatencyOutput: lockedProbe.rawLatencyOutput,
                        reasons: suspicionReasons
                    });
                }

                lockState.pendingLayer = null;
                lockState.pendingCount = 0;
                lockState.lockedLayerFailureCount = 0;
                lockState.timelineLayer = lockState.lockedLayer;
                lockState.timelineNs = trimSurfaceFlingerTimeline(
                    mergedTimeline,
                    timelineLatestNs,
                    SF_TIMELINE_KEEP_NS
                );

                if (!lockState.timelinePrimed) {
                    lockState.timelinePrimed = true;

                    if (timelineLatestNs !== null) {
                        latestPresentNs = timelineLatestNs;
                    } else if (lockedProbe.currentLatestNs !== null) {
                        latestPresentNs = lockedProbe.currentLatestNs;
                    }

                    const primedJankMetrics = buildSurfaceFlingerJankMetrics(
                        lockState.timelineNs,
                        lockState.lockedLayer
                    );

                    this.state.setSurfaceFlingerLock(collectionKey, lockState);

                    return {
                        datum: metric(
                            round(
                                clamp(
                                    effectiveFps,
                                    0,
                                    lockedProbe.maxReasonableFps
                                )
                            ),
                            "FPS",
                            `dumpsys SurfaceFlinger --latency ${lockedProbe.layerName}`
                        ),
                        jankDatum: primedJankMetrics.jankDatum,
                        bigJankDatum: primedJankMetrics.bigJankDatum,
                        sfLastPresentNs: latestPresentNs,
                        sfLayerName: lockState.lockedLayer,
                        candidates: buildLayerCandidates(
                            rankedCandidates,
                            tried,
                            [lockState.lockedLayer]
                        ),
                        layerSwitchReason: `保持图层锁定: ${lockState.lockedLayer}（时间轴已接管）`,
                        valueMode:
                            timelineFps !== null ? "timeline" : "snapshot",
                        sampleCount: lockedProbe.presentNs.length,
                        timelineCount: lockState.timelineNs.length,
                        timelinePrimed: lockState.timelinePrimed,
                        timelineNeedsClear: lockState.timelineNeedsClear
                    };
                }

                if (timelineLatestNs !== null) {
                    latestPresentNs = timelineLatestNs;
                } else if (lockedProbe.currentLatestNs !== null) {
                    latestPresentNs = lockedProbe.currentLatestNs;
                }

                this.state.setSurfaceFlingerLock(collectionKey, lockState);

                const lockedJankMetrics = buildSurfaceFlingerJankMetrics(
                    mergedTimeline,
                    lockState.lockedLayer
                );

                return {
                    datum: metric(
                        round(
                            clamp(effectiveFps, 0, lockedProbe.maxReasonableFps)
                        ),
                        "FPS",
                        `dumpsys SurfaceFlinger --latency ${lockedProbe.layerName}`
                    ),
                    jankDatum: lockedJankMetrics.jankDatum,
                    bigJankDatum: lockedJankMetrics.bigJankDatum,
                    sfLastPresentNs: latestPresentNs,
                    sfLayerName: lockState.lockedLayer,
                    candidates: buildLayerCandidates(rankedCandidates, tried, [
                        lockState.lockedLayer
                    ]),
                    layerSwitchReason: undefined,
                    valueMode: timelineFps !== null ? "timeline" : "snapshot",
                    sampleCount: lockedProbe.presentNs.length,
                    timelineCount: lockState.timelineNs.length,
                    timelinePrimed: lockState.timelinePrimed,
                    timelineNeedsClear: lockState.timelineNeedsClear
                };
            }

            lockState.lockedLayerFailureCount += 1;
            const retainedTimelineFps =
                lockState.timelinePrimed && lockState.timelineNs.length > 0
                    ? computeSurfaceFlingerTimelineFps(lockState.timelineNs)
                    : null;

            if (retainedTimelineFps !== null) {
                this.logSurfaceFlingerLatencyRecovery({
                    serial,
                    layerName: lockState.lockedLayer,
                    lockState,
                    retainedTimelineFps,
                    nextAction: "reuse-timeline"
                });
                this.state.setSurfaceFlingerLock(collectionKey, lockState);

                const retainedJankMetrics = buildSurfaceFlingerJankMetrics(
                    lockState.timelineNs,
                    lockState.lockedLayer
                );

                return {
                    datum: metric(
                        round(retainedTimelineFps),
                        "FPS",
                        `dumpsys SurfaceFlinger --latency ${lockState.lockedLayer}`
                    ),
                    jankDatum: retainedJankMetrics.jankDatum,
                    bigJankDatum: retainedJankMetrics.bigJankDatum,
                    sfLastPresentNs: latestPresentNs,
                    sfLayerName: lockState.lockedLayer,
                    candidates: buildLayerCandidates(rankedCandidates, tried, [
                        lockState.lockedLayer
                    ]),
                    layerSwitchReason: `保持图层锁定: ${lockState.lockedLayer}（沿用上一时间轴）`,
                    valueMode: "timeline",
                    sampleCount: 0,
                    timelineCount: lockState.timelineNs.length,
                    timelinePrimed: lockState.timelinePrimed,
                    timelineNeedsClear: lockState.timelineNeedsClear
                };
            }

            if (
                lockState.lockedLayerFailureCount <
                SF_RESELECT_ON_LOCK_FAILURE_SAMPLES
            ) {
                this.logSurfaceFlingerLatencyRecovery({
                    serial,
                    layerName: lockState.lockedLayer,
                    lockState,
                    retainedTimelineFps,
                    nextAction: "keep-lock-wait"
                });
                this.state.setSurfaceFlingerLock(collectionKey, lockState);

                return {
                    datum: unavailable(
                        "FPS",
                        "锁定图层暂时无有效帧数据，等待下一次采样",
                        "dumpsys SurfaceFlinger --latency"
                    ),
                    ...unavailableJankMetrics(
                        "锁定图层暂时无有效帧数据，等待下一次采样",
                        `dumpsys SurfaceFlinger --latency ${lockState.lockedLayer}`
                    ),
                    sfLastPresentNs: latestPresentNs,
                    sfLayerName: lockState.lockedLayer,
                    candidates: buildLayerCandidates(rankedCandidates, tried, [
                        lockState.lockedLayer
                    ]),
                    layerSwitchReason: `保持图层锁定: ${lockState.lockedLayer}（等待恢复）`,
                    valueMode: "unavailable",
                    sampleCount: 0,
                    timelineCount: lockState.timelineNs.length,
                    timelinePrimed: lockState.timelinePrimed,
                    timelineNeedsClear: lockState.timelineNeedsClear
                };
            }

            this.logSurfaceFlingerLatencyRecovery({
                serial,
                layerName: lockState.lockedLayer,
                lockState,
                retainedTimelineFps,
                nextAction: "keep-lock-unavailable"
            });
            this.state.setSurfaceFlingerLock(collectionKey, lockState);

            return {
                datum: unavailable(
                    "FPS",
                    "锁定图层持续无有效帧数据，但不会自动重选图层",
                    "dumpsys SurfaceFlinger --latency"
                ),
                ...unavailableJankMetrics(
                    "锁定图层持续无有效帧数据，但不会自动重选图层",
                    `dumpsys SurfaceFlinger --latency ${lockState.lockedLayer}`
                ),
                sfLastPresentNs: latestPresentNs,
                sfLayerName: lockState.lockedLayer,
                candidates: buildLayerCandidates(rankedCandidates, tried, [
                    lockState.lockedLayer
                ]),
                layerSwitchReason: `保持图层锁定: ${lockState.lockedLayer}（连续采样异常）`,
                valueMode: "unavailable",
                sampleCount: 0,
                timelineCount: lockState.timelineNs.length,
                timelinePrimed: lockState.timelinePrimed,
                timelineNeedsClear: lockState.timelineNeedsClear
            };
        }

        const attemptOrder: string[] = [];
        const attemptSet = new Set<string>();
        const candidateMap = new Map(
            rankedCandidates.map((candidate) => [candidate.layer, candidate])
        );

        if (lockState.lockedLayer) {
            attemptOrder.push(lockState.lockedLayer);
            attemptSet.add(lockState.lockedLayer);
        }

        if (prev?.sfLayerName) {
            attemptOrder.push(prev.sfLayerName);
            attemptSet.add(prev.sfLayerName);
        }

        for (const candidate of rankedCandidates
            .filter((item) => item.packageMatch)
            .slice(0, 12)) {
            if (attemptSet.has(candidate.layer)) {
                continue;
            }

            attemptOrder.push(candidate.layer);
            attemptSet.add(candidate.layer);
        }

        for (const candidate of rankedCandidates.slice(0, 8)) {
            if (attemptSet.has(candidate.layer)) {
                continue;
            }

            attemptOrder.push(candidate.layer);
            attemptSet.add(candidate.layer);
        }

        const tried = new Set<string>();
        const probes = new Map<string, SurfaceFlingerProbeResult>();
        const preferredLayer =
            lockState.lockedLayer ?? prev?.sfLayerName ?? null;

        for (const layerName of attemptOrder) {
            tried.add(layerName);

            const latencyRaw = await this.adb.shellAllowFailure(
                serial,
                `dumpsys SurfaceFlinger --latency ${shellQuote(layerName)}`
            );
            const latency = parseSurfaceFlingerLatency(latencyRaw);

            if (latency.presentNs.length === 0) {
                continue;
            }

            const currentLatest =
                latency.presentNs[latency.presentNs.length - 1] ?? null;
            if (currentLatest !== null) {
                latestPresentNs = currentLatest;
            }

            const fpsValue = computeSurfaceFlingerFps(latency, prev, layerName);
            const maxReasonableFps = latency.refreshHz
                ? latency.refreshHz * 1.2
                : 240;

            if (
                fpsValue === null ||
                !Number.isFinite(fpsValue) ||
                fpsValue < 0 ||
                fpsValue > maxReasonableFps * 1.5
            ) {
                continue;
            }

            const candidate = candidateMap.get(layerName);
            const probe: SurfaceFlingerProbeResult = {
                layerName,
                fpsValue: clamp(fpsValue, 0, maxReasonableFps),
                maxReasonableFps,
                refreshHz: latency.refreshHz,
                currentLatestNs: currentLatest,
                score: candidate?.score ?? 0,
                packageMatch: candidate?.packageMatch ?? false,
                presentNs: latency.presentNs,
                rawLatencyOutput: latencyRaw
            };
            probes.set(layerName, probe);

            if (
                currentLatest !== null &&
                (latestPresentNs === null || currentLatest > latestPresentNs)
            ) {
                latestPresentNs = currentLatest;
            }
        }

        const probeList = Array.from(probes.values());
        if (probeList.length === 0) {
            this.state.setSurfaceFlingerLock(collectionKey, lockState);

            return {
                datum: unavailable(
                    "FPS",
                    "SurfaceFlinger 帧时间不足，等待后续采样",
                    "dumpsys SurfaceFlinger --latency"
                ),
                ...unavailableJankMetrics(
                    "SurfaceFlinger 帧时间不足，等待后续采样",
                    "dumpsys SurfaceFlinger --latency"
                ),
                sfLastPresentNs: latestPresentNs,
                sfLayerName: lockState.lockedLayer ?? prev?.sfLayerName ?? null,
                candidates: buildLayerCandidates(
                    rankedCandidates,
                    tried,
                    attemptOrder
                ),
                layerSwitchReason: undefined,
                valueMode: "unavailable",
                sampleCount: 0,
                timelineCount: lockState.timelineNs.length,
                timelinePrimed: lockState.timelinePrimed,
                timelineNeedsClear: lockState.timelineNeedsClear
            };
        }

        const freshestPresentNs = probeList.reduce((max, probe) => {
            if (probe.currentLatestNs === null) {
                return max;
            }

            return probe.currentLatestNs > max ? probe.currentLatestNs : max;
        }, Number.NEGATIVE_INFINITY);

        const freshPool = Number.isFinite(freshestPresentNs)
            ? probeList.filter(
                  (probe) =>
                      probe.currentLatestNs !== null &&
                      freshestPresentNs - probe.currentLatestNs <=
                          SF_MAX_STALE_NS
              )
            : probeList;
        const candidatePool = freshPool.length > 0 ? freshPool : probeList;
        const packageMatchedPool = candidatePool.filter(
            (probe) => probe.packageMatch
        );
        const selectionPool =
            packageMatchedPool.length > 0 ? packageMatchedPool : candidatePool;

        const bestProbe = selectionPool.reduce((best, probe) =>
            isBetterSurfaceFlingerProbe(probe, best, preferredLayer)
                ? probe
                : best
        );

        const lockedLayer = lockState.lockedLayer;
        const lockedProbe = lockedLayer
            ? (probes.get(lockedLayer) ?? null)
            : null;

        let selectedProbe: SurfaceFlingerProbeResult;
        let layerSwitchReason: string | undefined;

        if (!lockedLayer) {
            if (lockState.pendingLayer === bestProbe.layerName) {
                lockState.pendingCount += 1;
            } else {
                lockState.pendingLayer = bestProbe.layerName;
                lockState.pendingCount = 1;
            }

            if (lockState.pendingCount >= SF_INITIAL_LOCK_CONFIRM_SAMPLES) {
                lockState.lockedLayer = bestProbe.layerName;
                lockState.pendingLayer = null;
                lockState.pendingCount = 0;
                lockState.lastSwitchAt = sampleTimestamp;
                lockState.timelineLayer = null;
                lockState.timelineNs = [];
                lockState.timelineNeedsClear = true;
                lockState.timelinePrimed = false;
                layerSwitchReason = `首次锁定 SurfaceFlinger 图层: ${bestProbe.layerName}`;
            } else {
                layerSwitchReason = `首次图层观察中: ${bestProbe.layerName} (${lockState.pendingCount}/${SF_INITIAL_LOCK_CONFIRM_SAMPLES})`;
            }

            selectedProbe = bestProbe;
        } else if (
            lockedProbe &&
            bestProbe.layerName !== lockedProbe.layerName
        ) {
            const switchDecision = decideSurfaceFlingerLayerSwitch(
                lockedProbe,
                bestProbe,
                lockState,
                sampleTimestamp
            );

            layerSwitchReason = switchDecision.reason;
            lockState.pendingLayer = switchDecision.pendingLayer;
            lockState.pendingCount = switchDecision.pendingCount;

            if (switchDecision.shouldSwitch) {
                selectedProbe = bestProbe;
                lockState.lockedLayer = bestProbe.layerName;
                lockState.lastSwitchAt = sampleTimestamp;
                lockState.timelineLayer = null;
                lockState.timelineNs = [];
                lockState.timelineNeedsClear = true;
                lockState.timelinePrimed = false;
            } else {
                selectedProbe = lockedProbe;
            }
        } else {
            selectedProbe = lockedProbe ?? bestProbe;
            lockState.pendingLayer = null;
            lockState.pendingCount = 0;

            if (!lockedProbe && bestProbe.layerName !== lockState.lockedLayer) {
                layerSwitchReason = `SurfaceFlinger 图层切换: ${lockState.lockedLayer} -> ${bestProbe.layerName}`;
                lockState.lockedLayer = bestProbe.layerName;
                lockState.lastSwitchAt = sampleTimestamp;
                lockState.timelineLayer = null;
                lockState.timelineNs = [];
                lockState.timelineNeedsClear = true;
                lockState.timelinePrimed = false;
                selectedProbe = bestProbe;
            }
        }

        const primedLatestNs = await this.primeSurfaceFlingerTimelineAfterLock(
            serial,
            lockState,
            prev,
            selectedProbe
        );

        if (primedLatestNs !== null) {
            latestPresentNs = primedLatestNs;
        } else if (selectedProbe.currentLatestNs !== null) {
            latestPresentNs = selectedProbe.currentLatestNs;
        }

        this.state.setSurfaceFlingerLock(collectionKey, lockState);

        const selectedJankMetrics = buildSurfaceFlingerJankMetrics(
            selectedProbe.presentNs,
            selectedProbe.layerName
        );

        return {
            datum: metric(
                round(
                    clamp(
                        selectedProbe.fpsValue,
                        0,
                        selectedProbe.maxReasonableFps
                    )
                ),
                "FPS",
                `dumpsys SurfaceFlinger --latency ${selectedProbe.layerName}`
            ),
            jankDatum: selectedJankMetrics.jankDatum,
            bigJankDatum: selectedJankMetrics.bigJankDatum,
            sfLastPresentNs: latestPresentNs,
            sfLayerName: selectedProbe.layerName,
            candidates: buildLayerCandidates(
                rankedCandidates,
                tried,
                attemptOrder
            ),
            layerSwitchReason,
            valueMode: "snapshot",
            sampleCount: selectedProbe.presentNs.length,
            timelineCount: lockState.timelineNs.length,
            timelinePrimed: lockState.timelinePrimed,
            timelineNeedsClear: lockState.timelineNeedsClear
        };
    }

    private logSurfaceFlingerLatencyAnomaly(params: {
        serial: string;
        layerName: string;
        reason: string;
        rawOutput: string;
        latency: SurfaceFlingerLatency;
        prev: CounterSnapshot | undefined;
        fpsValue: number | null;
        maxReasonableFps: number;
        score: number;
        packageMatch: boolean;
        lockState: SurfaceFlingerLockState;
    }): void {
        const rawLines = params.rawOutput
            .split(/\r?\n/)
            .map((line) => line.trimEnd());
        const numericLines = rawLines
            .map((line) => line.trim())
            .filter((line) => /^\d+(?:\s+\d+)*$/.test(line));

        console.warn("[SurfaceFlingerLatencyAnomaly]", {
            serial: params.serial,
            layerName: params.layerName,
            reason: params.reason,
            score: params.score,
            packageMatch: params.packageMatch,
            refreshHz:
                params.latency.refreshHz !== null
                    ? round(params.latency.refreshHz)
                    : null,
            presentCount: params.latency.presentNs.length,
            latestPresentNs:
                params.latency.presentNs[params.latency.presentNs.length - 1] ??
                null,
            presentTailNs: params.latency.presentNs.slice(-8),
            fpsValue:
                params.fpsValue !== null && Number.isFinite(params.fpsValue)
                    ? round(params.fpsValue)
                    : params.fpsValue,
            maxReasonableFps: round(params.maxReasonableFps),
            prevLayerName: params.prev?.sfLayerName ?? null,
            prevLastPresentNs: params.prev?.sfLastPresentNs ?? null,
            rawLineCount: rawLines.length,
            numericLineCount: numericLines.length,
            rawPreview: rawLines
                .filter((line) => line.trim().length > 0)
                .slice(0, 24)
                .join("\n"),
            rawOutput: params.rawOutput,
            lockState: {
                lockedLayer: params.lockState.lockedLayer,
                lockedLayerFailureCount:
                    params.lockState.lockedLayerFailureCount,
                timelineLayer: params.lockState.timelineLayer,
                timelineCount: params.lockState.timelineNs.length,
                timelineTailNs: params.lockState.timelineNs.slice(-8),
                timelinePrimed: params.lockState.timelinePrimed,
                timelineNeedsClear: params.lockState.timelineNeedsClear
            }
        });
    }

    private logSurfaceFlingerLatencyRecovery(params: {
        serial: string;
        layerName: string | null;
        lockState: SurfaceFlingerLockState;
        retainedTimelineFps: number | null;
        nextAction:
            | "reuse-timeline"
            | "keep-lock-wait"
            | "keep-lock-unavailable";
    }): void {
        console.warn("[SurfaceFlingerLatencyRecovery]", {
            serial: params.serial,
            layerName: params.layerName,
            nextAction: params.nextAction,
            retainedTimelineFps:
                params.retainedTimelineFps !== null
                    ? round(params.retainedTimelineFps)
                    : null,
            lockedLayerFailureCount: params.lockState.lockedLayerFailureCount,
            timelineLayer: params.lockState.timelineLayer,
            timelineCount: params.lockState.timelineNs.length,
            timelineTailNs: params.lockState.timelineNs.slice(-8),
            timelinePrimed: params.lockState.timelinePrimed,
            timelineNeedsClear: params.lockState.timelineNeedsClear
        });
    }

    private logSurfaceFlingerTimelineSuspicion(params: {
        serial: string;
        layerName: string | null;
        prev: CounterSnapshot | undefined;
        lockState: SurfaceFlingerLockState;
        snapshotFps: number;
        timelineFps: number | null;
        effectiveFps: number;
        refreshHz: number | null;
        mergeMarkerIndex: number;
        previousTimeline: number[];
        incomingTimeline: number[];
        mergedTimeline: number[];
        incomingNonIncreasingSteps: number;
        mergedNonIncreasingSteps: number;
        rawLatencyOutput: string;
        reasons: string[];
    }): void {
        console.warn("[SurfaceFlingerTimelineSuspicion]", {
            serial: params.serial,
            layerName: params.layerName,
            reasons: params.reasons,
            previousFrameCount: params.prev?.frameCount ?? null,
            previousLayerName: params.prev?.sfLayerName ?? null,
            previousLastPresentNs: params.prev?.sfLastPresentNs ?? null,
            snapshotFps: round(params.snapshotFps),
            timelineFps:
                params.timelineFps !== null ? round(params.timelineFps) : null,
            effectiveFps: round(params.effectiveFps),
            refreshHz:
                params.refreshHz !== null ? round(params.refreshHz) : null,
            mergeMarkerIndex: params.mergeMarkerIndex,
            previousTimelineCount: params.previousTimeline.length,
            incomingTimelineCount: params.incomingTimeline.length,
            mergedTimelineCount: params.mergedTimeline.length,
            previousTimelineTailNs: params.previousTimeline.slice(-12),
            incomingTimelineTailNs: params.incomingTimeline.slice(-12),
            mergedTimelineTailNs: params.mergedTimeline.slice(-12),
            incomingNonIncreasingSteps: params.incomingNonIncreasingSteps,
            mergedNonIncreasingSteps: params.mergedNonIncreasingSteps,
            lockState: {
                lockedLayer: params.lockState.lockedLayer,
                lockedLayerFailureCount:
                    params.lockState.lockedLayerFailureCount,
                timelineLayer: params.lockState.timelineLayer,
                timelineCount: params.lockState.timelineNs.length,
                timelinePrimed: params.lockState.timelinePrimed,
                timelineNeedsClear: params.lockState.timelineNeedsClear
            },
            rawLatencyOutput: params.rawLatencyOutput
        });
    }

    private async primeSurfaceFlingerTimelineAfterLock(
        serial: string,
        lockState: SurfaceFlingerLockState,
        prev: CounterSnapshot | undefined,
        selectedProbe: SurfaceFlingerProbeResult
    ): Promise<number | null> {
        if (
            !lockState.timelineNeedsClear ||
            !lockState.lockedLayer ||
            lockState.lockedLayer !== selectedProbe.layerName
        ) {
            return null;
        }

        await this.clearSurfaceFlingerLatency(serial, lockState.lockedLayer);
        await this.waitForSurfaceFlingerWarmup();

        lockState.timelineNeedsClear = false;
        lockState.timelineLayer = lockState.lockedLayer;
        lockState.timelineNs = [];
        lockState.timelinePrimed = false;

        const primingProbe = await this.probeSurfaceFlingerLayer(
            serial,
            lockState.lockedLayer,
            prev,
            selectedProbe.score,
            selectedProbe.packageMatch,
            lockState
        );

        if (!primingProbe) {
            return null;
        }

        const primedTimeline = trimSurfaceFlingerTimeline(
            primingProbe.presentNs,
            primingProbe.currentLatestNs,
            SF_TIMELINE_KEEP_NS
        );
        lockState.timelineLayer = lockState.lockedLayer;
        lockState.timelineNs = primedTimeline;
        lockState.timelinePrimed = primedTimeline.length > 0;

        return (
            primedTimeline[primedTimeline.length - 1] ??
            primingProbe.currentLatestNs
        );
    }

    private async probeSurfaceFlingerLayer(
        serial: string,
        layerName: string,
        prev: CounterSnapshot | undefined,
        score: number,
        packageMatch: boolean,
        lockState: SurfaceFlingerLockState
    ): Promise<SurfaceFlingerProbeResult | null> {
        const latencyRaw = await this.adb.shellAllowFailure(
            serial,
            `dumpsys SurfaceFlinger --latency ${shellQuote(layerName)}`
        );
        const latency = parseSurfaceFlingerLatency(latencyRaw);
        const maxReasonableFps = latency.refreshHz
            ? latency.refreshHz * 1.2
            : 240;

        if (latency.presentNs.length === 0) {
            this.logSurfaceFlingerLatencyAnomaly({
                serial,
                layerName,
                reason: "empty-present-ns",
                rawOutput: latencyRaw,
                latency,
                prev,
                fpsValue: null,
                maxReasonableFps,
                score,
                packageMatch,
                lockState
            });
            return null;
        }

        const currentLatest =
            latency.presentNs[latency.presentNs.length - 1] ?? null;
        const fpsValue = computeSurfaceFlingerFps(latency, prev, layerName);

        let anomalyReason: string | null = null;

        if (fpsValue === null) {
            anomalyReason = "fps-null";
        } else if (!Number.isFinite(fpsValue)) {
            anomalyReason = "fps-non-finite";
        } else if (fpsValue < 0) {
            anomalyReason = "fps-negative";
        } else if (fpsValue > maxReasonableFps * 1.5) {
            anomalyReason = "fps-too-large";
        }

        if (anomalyReason) {
            this.logSurfaceFlingerLatencyAnomaly({
                serial,
                layerName,
                reason: anomalyReason,
                rawOutput: latencyRaw,
                latency,
                prev,
                fpsValue,
                maxReasonableFps,
                score,
                packageMatch,
                lockState
            });
            return null;
        }

        if (fpsValue === null) {
            return null;
        }

        return {
            layerName,
            fpsValue: clamp(fpsValue, 0, maxReasonableFps),
            maxReasonableFps,
            refreshHz: latency.refreshHz,
            currentLatestNs: currentLatest,
            score,
            packageMatch,
            presentNs: latency.presentNs,
            rawLatencyOutput: latencyRaw
        };
    }

    private async clearSurfaceFlingerLatency(
        serial: string,
        layerName: string
    ): Promise<void> {
        await this.adb.shellAllowFailure(
            serial,
            `dumpsys SurfaceFlinger --latency-clear ${shellQuote(layerName)}`
        );
    }

    private async waitForSurfaceFlingerWarmup(): Promise<void> {
        await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 100);
        });
    }
}

function buildLayerCandidates(
    rankedCandidates: Array<{
        layer: string;
        score: number;
        packageMatch: boolean;
    }>,
    tried: Set<string>,
    attemptOrder: string[]
): FpsLayerCandidate[] {
    const topCandidates = rankedCandidates.slice(0, 8);
    const result: FpsLayerCandidate[] = topCandidates.map((candidate) => ({
        layer: candidate.layer,
        score: candidate.score,
        packageMatch: candidate.packageMatch,
        tried: tried.has(candidate.layer)
    }));

    for (const layer of attemptOrder) {
        if (result.some((candidate) => candidate.layer === layer)) {
            continue;
        }

        result.push({
            layer,
            score: 0,
            packageMatch: false,
            tried: tried.has(layer)
        });
    }

    return result;
}
