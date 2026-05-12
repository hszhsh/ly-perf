import type { MetricDatum } from "@shared/types";
import {
    clamp,
    metric,
    round,
    unavailable,
    unavailableJankMetrics
} from "@main/services/MetricCollectorCommon";
import type { CounterSnapshot } from "@main/services/MetricCollectorState";
import type { SurfaceFlingerLockState } from "@main/services/MetricCollectorState";

export interface SurfaceFlingerLatency {
    refreshHz: number | null;
    presentNs: number[];
}

export interface FpsComputationResult {
    datum: MetricDatum;
    jankDatum: MetricDatum;
    bigJankDatum: MetricDatum;
    frameCount: number | null;
    latestFrameCompletedNs: number | null;
}

export interface FrameJankMetrics {
    jankDatum: MetricDatum;
    bigJankDatum: MetricDatum;
    latestFrameTimestampNs: number | null;
}

export interface RankedFpsLayerCandidate {
    layer: string;
    score: number;
    packageMatch: boolean;
}

export interface SurfaceFlingerProbeResult {
    layerName: string;
    fpsValue: number;
    maxReasonableFps: number;
    refreshHz: number | null;
    currentLatestNs: number | null;
    score: number;
    packageMatch: boolean;
    presentNs: number[];
    rawLatencyOutput: string;
}

export interface SurfaceFlingerSwitchDecision {
    shouldSwitch: boolean;
    pendingLayer: string | null;
    pendingCount: number;
    reason?: string;
}

const SF_MAX_REASONABLE_TIMESTAMP_NS = 1_000_000_000_000_000_000;
const MOVIE_FRAME_TIME_MS = 1000 / 24;
const JANK_FRAME_TIME_MS = MOVIE_FRAME_TIME_MS * 2;
const BIG_JANK_FRAME_TIME_MS = MOVIE_FRAME_TIME_MS * 3;
const JANK_BASELINE_FRAME_COUNT = 3;
const JANK_RATIO_MULTIPLIER = 2;
const SF_SWITCH_CONFIRM_SAMPLES = 3;
const SF_SWITCH_MIN_IMPROVEMENT_FPS = 8;
const SF_SWITCH_MIN_IMPROVEMENT_RATIO = 0.2;
const SF_SWITCH_COOLDOWN_MS = 10_000;
const SF_LOW_FPS_ESCAPE_THRESHOLD = 12;

export function parseGfxInfoFps(
    gfxInfo: string,
    prev: CounterSnapshot | undefined,
    timestamp: number
): FpsComputationResult {
    const frameStats = parseGfxInfoFrameStats(gfxInfo);
    const frameCount = frameStats.frameCount;
    const jankMetrics = computeFrameJankMetrics(
        frameStats.frameCompletedNs,
        prev?.gfxLastFrameCompletedNs ?? null,
        "dumpsys gfxinfo framestats (app scoped)",
        {
            emptyReason: "gfxinfo 未提供逐帧 FrameStats",
            waitingReason: "等待下一次采样计算 Jank",
            noNewFramesReason: "gfxinfo 当前采样无新增帧时间",
            insufficientReason: "gfxinfo 新增帧不足以判断 Jank"
        }
    );

    if (frameCount === null) {
        return {
            datum: unavailable(
                "FPS",
                "无法从 gfxinfo 读取帧统计",
                "dumpsys gfxinfo"
            ),
            jankDatum: jankMetrics.jankDatum,
            bigJankDatum: jankMetrics.bigJankDatum,
            frameCount: null,
            latestFrameCompletedNs: jankMetrics.latestFrameTimestampNs
        };
    }

    if (!prev || prev.frameCount === null) {
        return {
            datum: unavailable(
                "FPS",
                "等待下一次采样计算 FPS",
                "dumpsys gfxinfo"
            ),
            jankDatum: jankMetrics.jankDatum,
            bigJankDatum: jankMetrics.bigJankDatum,
            frameCount,
            latestFrameCompletedNs: jankMetrics.latestFrameTimestampNs
        };
    }

    const deltaFrames = frameCount - prev.frameCount;
    if (deltaFrames < 0) {
        return {
            datum: unavailable(
                "FPS",
                "gfxinfo 帧计数重置，等待下一次采样",
                "dumpsys gfxinfo"
            ),
            jankDatum: jankMetrics.jankDatum,
            bigJankDatum: jankMetrics.bigJankDatum,
            frameCount,
            latestFrameCompletedNs: jankMetrics.latestFrameTimestampNs
        };
    }

    const deltaSeconds = Math.max((timestamp - prev.timestamp) / 1000, 0.001);
    const fpsValue = deltaFrames / deltaSeconds;
    const maxReasonableFps = 240;

    if (
        !Number.isFinite(fpsValue) ||
        fpsValue < 0 ||
        fpsValue > maxReasonableFps * 1.2
    ) {
        return {
            datum: unavailable(
                "FPS",
                "gfxinfo 计算结果异常",
                "dumpsys gfxinfo"
            ),
            jankDatum: jankMetrics.jankDatum,
            bigJankDatum: jankMetrics.bigJankDatum,
            frameCount,
            latestFrameCompletedNs: jankMetrics.latestFrameTimestampNs
        };
    }

    return {
        datum: metric(
            round(clamp(fpsValue, 0, maxReasonableFps)),
            "FPS",
            "dumpsys gfxinfo (app scoped)"
        ),
        jankDatum: jankMetrics.jankDatum,
        bigJankDatum: jankMetrics.bigJankDatum,
        frameCount,
        latestFrameCompletedNs: jankMetrics.latestFrameTimestampNs
    };
}

export function parseSurfaceFlingerLatency(raw: string): SurfaceFlingerLatency {
    const numericLines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^\d+(?:\s+\d+)*$/.test(line));

    if (numericLines.length === 0) {
        return {
            refreshHz: null,
            presentNs: []
        };
    }

    const refreshPeriodNs = Number(numericLines[0]);
    const refreshHz =
        refreshPeriodNs > 0 ? 1_000_000_000 / refreshPeriodNs : null;

    const presentNs = numericLines
        .slice(1)
        .map((line) => line.split(/\s+/).map((part) => Number(part)))
        .filter((parts) => parts.length >= 3)
        .map((parts) => {
            const submitting = Number(parts[1]);

            if (Number.isFinite(submitting) && submitting > 0) {
                return submitting;
            }

            return null;
        })
        .filter((value): value is number => value !== null);

    return {
        refreshHz,
        presentNs: sanitizeSurfaceFlingerTimeline(presentNs)
    };
}

export function computeFrameJankMetrics(
    frameTimestampsNs: number[],
    previousFrameTimestampNs: number | null,
    source: string,
    reasons?: {
        emptyReason?: string;
        waitingReason?: string;
        noNewFramesReason?: string;
        insufficientReason?: string;
    }
): FrameJankMetrics {
    const sanitized = sanitizeSurfaceFlingerTimeline(frameTimestampsNs);
    const latestFrameTimestampNs = sanitized[sanitized.length - 1] ?? null;
    const emptyReason = reasons?.emptyReason ?? "帧时间不足，无法计算 Jank";
    const waitingReason = reasons?.waitingReason ?? "等待下一次采样计算 Jank";
    const noNewFramesReason =
        reasons?.noNewFramesReason ?? "当前采样无新增帧时间";
    const insufficientReason =
        reasons?.insufficientReason ?? "新增帧不足以判断 Jank";

    if (sanitized.length === 0) {
        return {
            ...unavailableJankMetrics(emptyReason, source),
            latestFrameTimestampNs
        };
    }

    if (previousFrameTimestampNs === null) {
        return {
            ...unavailableJankMetrics(waitingReason, source),
            latestFrameTimestampNs
        };
    }

    let jankCount = 0;
    let bigJankCount = 0;
    let newFrameCount = 0;
    let evaluatedFrameCount = 0;

    for (
        let index = JANK_BASELINE_FRAME_COUNT + 1;
        index < sanitized.length;
        index += 1
    ) {
        const currentFrameTimestampNs = sanitized[index];
        if (currentFrameTimestampNs <= previousFrameTimestampNs) {
            continue;
        }

        newFrameCount += 1;

        const previousFrameTimesMs = [
            (sanitized[index - 3] - sanitized[index - 4]) / 1_000_000,
            (sanitized[index - 2] - sanitized[index - 3]) / 1_000_000,
            (sanitized[index - 1] - sanitized[index - 2]) / 1_000_000
        ];
        const currentFrameTimeMs =
            (sanitized[index] - sanitized[index - 1]) / 1_000_000;
        const previousAverageMs =
            (previousFrameTimesMs[0] +
                previousFrameTimesMs[1] +
                previousFrameTimesMs[2]) /
            JANK_BASELINE_FRAME_COUNT;

        if (
            previousFrameTimesMs.some(
                (value) => !Number.isFinite(value) || value <= 0
            ) ||
            !Number.isFinite(currentFrameTimeMs) ||
            currentFrameTimeMs <= 0 ||
            !Number.isFinite(previousAverageMs) ||
            previousAverageMs <= 0
        ) {
            continue;
        }

        evaluatedFrameCount += 1;

        if (currentFrameTimeMs <= previousAverageMs * JANK_RATIO_MULTIPLIER) {
            continue;
        }

        if (currentFrameTimeMs > BIG_JANK_FRAME_TIME_MS) {
            jankCount += 1;
            bigJankCount += 1;
            continue;
        }

        if (currentFrameTimeMs > JANK_FRAME_TIME_MS) {
            jankCount += 1;
        }
    }

    if (newFrameCount === 0) {
        return {
            ...unavailableJankMetrics(noNewFramesReason, source),
            latestFrameTimestampNs
        };
    }

    if (evaluatedFrameCount === 0) {
        return {
            ...unavailableJankMetrics(insufficientReason, source),
            latestFrameTimestampNs
        };
    }

    return {
        jankDatum: metric(jankCount, "count", source),
        bigJankDatum: metric(bigJankCount, "count", source),
        latestFrameTimestampNs
    };
}

export function isValidSurfaceFlingerTimestamp(timestampNs: number): boolean {
    return (
        Number.isFinite(timestampNs) &&
        timestampNs > 0 &&
        timestampNs < SF_MAX_REASONABLE_TIMESTAMP_NS
    );
}

export function sanitizeSurfaceFlingerTimeline(values: number[]): number[] {
    const sanitized: number[] = [];

    for (const value of values) {
        if (!isValidSurfaceFlingerTimestamp(value)) {
            continue;
        }

        if (sanitized.length > 0 && value <= sanitized[sanitized.length - 1]) {
            continue;
        }

        sanitized.push(value);
    }

    return sanitized;
}

export function normalizeSurfaceLayerName(rawLine: string): string {
    let layer = rawLine.trim();
    if (!layer) {
        return "";
    }

    const requestedStateMatch = layer.match(/^RequestedLayerState\{(.+)\}$/);
    if (requestedStateMatch?.[1]) {
        layer = requestedStateMatch[1].trim();
    }

    layer =
        layer.split(/\s(?:parentId|relativeParentId|z)=/)[0]?.trim() ?? layer;
    return layer;
}

export function parseSurfaceFlingerLayers(raw: string): string[] {
    const seen = new Set<string>();
    const layers: string[] = [];

    for (const line of raw.split(/\r?\n/)) {
        const normalized = normalizeSurfaceLayerName(line);
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        layers.push(normalized);
    }

    return layers;
}

export function scoreSurfaceLayer(layer: string, packageName?: string): number {
    const lower = layer.toLowerCase();
    let rank = 0;

    if (packageName && lower.includes(packageName.toLowerCase())) {
        rank += 300;
    }
    if (lower.includes("surfaceview[")) {
        rank += 120;
    }
    if (lower.includes("(blast)")) {
        rank += 80;
    }
    if (layer.includes("#")) {
        rank += 5;
    }

    if (lower.includes("background for")) {
        rank -= 200;
    }
    if (lower.includes("inputsink") || lower.includes("input consumer")) {
        rank -= 150;
    }
    if (lower.includes("gesture")) {
        rank -= 80;
    }
    if (lower.includes("roundcorner")) {
        rank -= 80;
    }
    if (lower.includes("navigationbar") || lower.includes("statusbar")) {
        rank -= 90;
    }
    if (lower.includes("wallpaper")) {
        rank -= 80;
    }
    if (lower.includes("dim layer")) {
        rank -= 60;
    }

    return rank;
}

export function appendCandidateIfMissing(
    candidates: RankedFpsLayerCandidate[],
    layerName: string,
    packageName: string
): void {
    if (candidates.some((candidate) => candidate.layer === layerName)) {
        return;
    }

    candidates.push({
        layer: layerName,
        score: scoreSurfaceLayer(layerName, packageName),
        packageMatch: layerName
            .toLowerCase()
            .includes(packageName.toLowerCase())
    });
}

export function isBetterSurfaceFlingerProbe(
    current: SurfaceFlingerProbeResult,
    best: SurfaceFlingerProbeResult,
    preferredLayer: string | null
): boolean {
    if (current.currentLatestNs !== null && best.currentLatestNs === null) {
        return true;
    }

    if (best.currentLatestNs !== null && current.currentLatestNs === null) {
        return false;
    }

    if (current.currentLatestNs !== null && best.currentLatestNs !== null) {
        if (current.currentLatestNs > best.currentLatestNs + 500_000_000) {
            return true;
        }

        if (best.currentLatestNs > current.currentLatestNs + 500_000_000) {
            return false;
        }
    }

    if (current.fpsValue > best.fpsValue + 2) {
        return true;
    }

    if (best.fpsValue > current.fpsValue + 2) {
        return false;
    }

    if (current.packageMatch !== best.packageMatch) {
        return current.packageMatch;
    }

    if (current.score !== best.score) {
        return current.score > best.score;
    }

    if (preferredLayer) {
        if (
            current.layerName === preferredLayer &&
            best.layerName !== preferredLayer
        ) {
            return true;
        }

        if (
            best.layerName === preferredLayer &&
            current.layerName !== preferredLayer
        ) {
            return false;
        }
    }

    return current.fpsValue > best.fpsValue;
}

export function decideSurfaceFlingerLayerSwitch(
    lockedProbe: SurfaceFlingerProbeResult,
    challenger: SurfaceFlingerProbeResult,
    lockState: SurfaceFlingerLockState,
    sampleTimestamp: number
): SurfaceFlingerSwitchDecision {
    const fpsGain = challenger.fpsValue - lockedProbe.fpsValue;
    const ratioGain =
        lockedProbe.fpsValue > 0 ? fpsGain / lockedProbe.fpsValue : 1;
    const hasSignificantGain =
        fpsGain >= SF_SWITCH_MIN_IMPROVEMENT_FPS ||
        ratioGain >= SF_SWITCH_MIN_IMPROVEMENT_RATIO;
    const lowFpsEscape =
        lockedProbe.fpsValue <= SF_LOW_FPS_ESCAPE_THRESHOLD && fpsGain >= 4;

    if (!hasSignificantGain && !lowFpsEscape) {
        return {
            shouldSwitch: false,
            pendingLayer: null,
            pendingCount: 0,
            reason: `保持图层锁定: ${lockedProbe.layerName}（候选增益不足）`
        };
    }

    const elapsedSinceLastSwitch = sampleTimestamp - lockState.lastSwitchAt;
    if (
        lockState.lastSwitchAt > 0 &&
        elapsedSinceLastSwitch < SF_SWITCH_COOLDOWN_MS
    ) {
        return {
            shouldSwitch: false,
            pendingLayer: null,
            pendingCount: 0,
            reason: `保持图层锁定: 切换冷却中（${Math.ceil((SF_SWITCH_COOLDOWN_MS - elapsedSinceLastSwitch) / 1000)}s）`
        };
    }

    const requiredSamples = lowFpsEscape ? 1 : SF_SWITCH_CONFIRM_SAMPLES;
    const pendingCount =
        lockState.pendingLayer === challenger.layerName
            ? lockState.pendingCount + 1
            : 1;

    if (pendingCount < requiredSamples) {
        return {
            shouldSwitch: false,
            pendingLayer: challenger.layerName,
            pendingCount,
            reason: `保持图层锁定: ${challenger.layerName} 观察中（${pendingCount}/${requiredSamples}）`
        };
    }

    return {
        shouldSwitch: true,
        pendingLayer: null,
        pendingCount: 0,
        reason: `SurfaceFlinger 图层切换: ${lockedProbe.layerName} -> ${challenger.layerName}（提升 ${round(
            fpsGain
        )} FPS）`
    };
}

export function countSurfaceFlingerNonIncreasingSteps(
    values: number[]
): number {
    let count = 0;

    for (let index = 1; index < values.length; index += 1) {
        if (values[index] <= values[index - 1]) {
            count += 1;
        }
    }

    return count;
}

export function mergeSurfaceFlingerTimeline(
    previous: number[],
    incoming: number[]
): number[] {
    const sanitizedPrevious = sanitizeSurfaceFlingerTimeline(previous);
    const sanitizedIncoming = sanitizeSurfaceFlingerTimeline(incoming);

    if (sanitizedIncoming.length === 0) {
        return [...sanitizedPrevious];
    }

    if (sanitizedPrevious.length === 0) {
        return [...sanitizedIncoming];
    }

    const recent = sanitizedPrevious[sanitizedPrevious.length - 1] as number;
    const index = sanitizedIncoming.indexOf(recent);

    if (index >= 0) {
        return [...sanitizedPrevious, ...sanitizedIncoming.slice(index + 1)];
    }

    return sanitizeSurfaceFlingerTimeline([
        ...sanitizedPrevious,
        ...sanitizedIncoming
    ]);
}

export function computeSurfaceFlingerTimelineFps(
    timeline: number[]
): number | null {
    const sanitizedTimeline = sanitizeSurfaceFlingerTimeline(timeline);

    if (sanitizedTimeline.length === 0) {
        return null;
    }

    const latest = sanitizedTimeline[sanitizedTimeline.length - 1] as number;
    const from = latest - 1_000_000_000;
    const fpsCount = sanitizedTimeline.filter((value) => value > from).length;

    if (fpsCount <= 0) {
        return null;
    }

    return fpsCount;
}

export function trimSurfaceFlingerTimeline(
    timeline: number[],
    latest: number | null,
    keepNs: number
): number[] {
    const sanitizedTimeline = sanitizeSurfaceFlingerTimeline(timeline);

    if (
        sanitizedTimeline.length === 0 ||
        latest === null ||
        !isValidSurfaceFlingerTimestamp(latest)
    ) {
        return [];
    }

    const cutoff = latest - keepNs;
    const trimmed = sanitizedTimeline.filter((value) => value >= cutoff);
    if (trimmed.length <= 2048) {
        return trimmed;
    }

    return trimmed.slice(trimmed.length - 2048);
}

export function computeSurfaceFlingerFps(
    latency: SurfaceFlingerLatency,
    prev: CounterSnapshot | undefined,
    layerName: string
): number | null {
    if (latency.presentNs.length === 0) {
        return null;
    }

    const currentLatest = latency.presentNs[
        latency.presentNs.length - 1
    ] as number;
    const fromNs = currentLatest - 1_000_000_000;
    const framesInLastSecond = latency.presentNs.filter(
        (value) => value > fromNs && value <= currentLatest
    ).length;

    if (framesInLastSecond <= 0) {
        return null;
    }

    if (
        prev?.sfLayerName === layerName &&
        prev.sfLastPresentNs !== null &&
        currentLatest <= prev.sfLastPresentNs
    ) {
        return framesInLastSecond;
    }

    return framesInLastSecond;
}

function parseGfxInfoFrameStats(raw: string): {
    frameCount: number | null;
    frameCompletedNs: number[];
} {
    const frameMatch = raw.match(/Total frames rendered:\s*(\d+)/i);
    const frameCount = frameMatch?.[1] ? Number(frameMatch[1]) : null;
    const frameCompletedNs: number[] = [];
    let inProfileData = false;
    let frameCompletedIndex = -1;
    let flagsIndex = -1;

    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (line.startsWith("---PROFILEDATA---")) {
            inProfileData = !inProfileData;
            frameCompletedIndex = -1;
            flagsIndex = -1;
            continue;
        }

        if (!inProfileData) {
            continue;
        }

        const columns = line.split(",").map((part) => part.trim());

        if (frameCompletedIndex < 0) {
            frameCompletedIndex = columns.findIndex(
                (part) => part === "FrameCompleted"
            );
            flagsIndex = columns.findIndex((part) => part === "Flags");
            continue;
        }

        if (columns.length <= frameCompletedIndex) {
            continue;
        }

        if (flagsIndex >= 0) {
            const flags = Number(columns[flagsIndex]);
            if (Number.isFinite(flags) && flags !== 0) {
                continue;
            }
        }

        const frameCompleted = Number(columns[frameCompletedIndex]);
        if (isValidSurfaceFlingerTimestamp(frameCompleted)) {
            frameCompletedNs.push(frameCompleted);
        }
    }

    return {
        frameCount,
        frameCompletedNs: sanitizeSurfaceFlingerTimeline(frameCompletedNs)
    };
}
