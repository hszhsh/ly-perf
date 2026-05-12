import type {
  CpuUsageMode,
  CapabilityAdapter,
  CapabilityGroup,
  FpsDebugInfo,
  FpsLayerCandidate,
  FpsMode,
  MetricCapabilityReport,
  MetricDatum,
  MetricSnapshot
} from "@shared/types";
import { AdbClient } from "@main/adb/AdbClient";

export interface MetricCollectResult {
  metrics: MetricSnapshot;
  fpsDebug: FpsDebugInfo;
  capabilityReport: MetricCapabilityReport;
}

interface CounterSnapshot {
  timestamp: number;
  rxBytes: number;
  txBytes: number;
  networkTotalBytes: number;
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

interface CpuTickCounters {
  totalTicks: number;
  idleTicks: number;
}

interface SurfaceFlingerLatency {
  refreshHz: number | null;
  presentNs: number[];
}

interface SurfaceFlingerResult {
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

interface FpsComputationResult {
  datum: MetricDatum;
  jankDatum: MetricDatum;
  bigJankDatum: MetricDatum;
  frameCount: number | null;
  latestFrameCompletedNs: number | null;
}

interface FpsResult {
  datum: MetricDatum;
  jankDatum: MetricDatum;
  bigJankDatum: MetricDatum;
  frameCount: number | null;
  gfxLastFrameCompletedNs: number | null;
  sfLastPresentNs: number | null;
  sfLayerName: string | null;
  debug: FpsDebugInfo;
}

interface SurfaceFlingerProbeResult {
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

interface SurfaceFlingerLockState {
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

interface SurfaceFlingerSwitchDecision {
  shouldSwitch: boolean;
  pendingLayer: string | null;
  pendingCount: number;
  reason?: string;
}

interface PowerResult {
  datum: MetricDatum;
  chargeUah: number | null;
  group: CapabilityGroup;
}

interface GpuResult {
  datum: MetricDatum;
  group: CapabilityGroup;
}

interface GpuSource {
  kgslBusyPercentage: string;
  kgslGpubusy: string;
  kgslCurFreq: string;
  kgslMaxFreq: string;
  mtkGedGpuLoading: string;
  mtkGedGpuUtilization: string;
  mtkGpufreqVarDump: string;
  samsungMaliUtilization: string;
  maliUtilization: string;
  exynosMaliUtilization: string;
  devfreqProbe: string;
}

interface PowerSource {
  batteryInfo: string;
  currentNow: string;
  currentAvg: string;
  currentMa: string;
  batteryAverageCurrent: string;
  fgCurrent: string;
  battCurrentUaNow: string;
  powerNow: string;
  voltageNow: string;
  chargeCounter: string;
}

interface CpuFrequencyTotals {
  sumCurrentKhz: number;
  sumMaxKhz: number;
  source: string;
}

type BatteryTrend = "charging" | "discharging" | "unknown";
type CurrentUnitHint = "auto" | "ua" | "ma";

const DISK_NAME_REGEX = /^(mmcblk\d+|sda\d*|vda\d*|nvme\d+n\d+(p\d+)?)$/;
const DEVFREQ_GPU_PROBE_COMMAND =
  "for d in /sys/class/devfreq/*; do " +
  "if [ -d \"$d\" ]; then " +
  "name=$(cat \"$d/name\" 2>/dev/null); " +
  "case \"$name\" in " +
  "*[Gg][Pp][Uu]*|*[Mm]ali*|*[Aa]dreno*|*kgsl*|*3d*) " +
  "load=$(cat \"$d/load\" 2>/dev/null); " +
  "gpu_load=$(cat \"$d/gpu_load\" 2>/dev/null); " +
  "utilization=$(cat \"$d/utilization\" 2>/dev/null); " +
  "cur_freq=$(cat \"$d/cur_freq\" 2>/dev/null); " +
  "max_freq=$(cat \"$d/max_freq\" 2>/dev/null); " +
  "echo \"name=$name\"; " +
  "echo \"load=$load\"; " +
  "echo \"gpu_load=$gpu_load\"; " +
  "echo \"utilization=$utilization\"; " +
  "echo \"cur_freq=$cur_freq\"; " +
  "echo \"max_freq=$max_freq\"; " +
  "break;; " +
  "esac; " +
  "fi; " +
  "done";
const CPU_FREQ_PROBE_COMMAND =
  "if ls /sys/devices/system/cpu/cpufreq/policy* >/dev/null 2>&1; then " +
  "for d in /sys/devices/system/cpu/cpufreq/policy*; do " +
  "if [ -d \"$d\" ]; then " +
  "name=${d##*/}; " +
  "cur=$(cat \"$d/scaling_cur_freq\" 2>/dev/null); " +
  "if [ -z \"$cur\" ]; then cur=$(cat \"$d/cpuinfo_cur_freq\" 2>/dev/null); fi; " +
  "max=$(cat \"$d/cpuinfo_max_freq\" 2>/dev/null); " +
  "if [ -z \"$max\" ]; then max=$(cat \"$d/scaling_max_freq\" 2>/dev/null); fi; " +
  "cpus=$(cat \"$d/related_cpus\" 2>/dev/null); " +
  "echo \"policy $name cur=$cur max=$max cpus=$cpus\"; " +
  "fi; " +
  "done; " +
  "else " +
  "for d in /sys/devices/system/cpu/cpu[0-9]*; do " +
  "if [ -d \"$d/cpufreq\" ]; then " +
  "name=${d##*/}; " +
  "cur=$(cat \"$d/cpufreq/scaling_cur_freq\" 2>/dev/null); " +
  "if [ -z \"$cur\" ]; then cur=$(cat \"$d/cpufreq/cpuinfo_cur_freq\" 2>/dev/null); fi; " +
  "max=$(cat \"$d/cpufreq/cpuinfo_max_freq\" 2>/dev/null); " +
  "if [ -z \"$max\" ]; then max=$(cat \"$d/cpufreq/scaling_max_freq\" 2>/dev/null); fi; " +
  "echo \"cpu $name cur=$cur max=$max\"; " +
  "fi; " +
  "done; " +
  "fi";

function buildProcessCpuStatCommand(packageName: string): string {
  const quotedPackageName = shellQuote(packageName);

  return (
    `pkg=${quotedPackageName}; ` +
    "ps -A -o PID,ARGS 2>/dev/null | " +
    "while read -r pid args; do " +
    "case \"$pid\" in ''|*[!0-9]*) continue ;; esac; " +
    "case \"$args\" in \"$pkg\"|\"$pkg\":*) cat \"/proc/$pid/stat\" 2>/dev/null ;; esac; " +
    "done"
  );
}
const SF_SWITCH_CONFIRM_SAMPLES = 3;
const SF_SWITCH_MIN_IMPROVEMENT_FPS = 8;
const SF_SWITCH_MIN_IMPROVEMENT_RATIO = 0.2;
const SF_SWITCH_COOLDOWN_MS = 10_000;
const SF_LOW_FPS_ESCAPE_THRESHOLD = 12;
const SF_INITIAL_LOCK_CONFIRM_SAMPLES = 2;
const SF_MAX_STALE_NS = 2_000_000_000;
const SF_RESELECT_ON_LOCK_FAILURE_SAMPLES = 2;
const SF_TIMELINE_KEEP_NS = 10_000_000_000;
const SF_MAX_REASONABLE_TIMESTAMP_NS = 1_000_000_000_000_000_000;
const MOVIE_FRAME_TIME_MS = 1000 / 24;
const JANK_FRAME_TIME_MS = MOVIE_FRAME_TIME_MS * 2;
const BIG_JANK_FRAME_TIME_MS = MOVIE_FRAME_TIME_MS * 3;
const JANK_BASELINE_FRAME_COUNT = 3;
const JANK_RATIO_MULTIPLIER = 2;

function metric(value: number, unit: string, source: string): MetricDatum {
  return {
    value,
    unit,
    source,
    available: true
  };
}

function unavailable(unit: string, reason: string, source: string): MetricDatum {
  return {
    value: null,
    unit,
    source,
    available: false,
    reason
  };
}

function unavailableJankMetrics(reason: string, source: string): {
  jankDatum: MetricDatum;
  bigJankDatum: MetricDatum;
} {
  return {
    jankDatum: unavailable("count", reason, source),
    bigJankDatum: unavailable("count", reason, source)
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseFirstNumber(raw: string): number | null {
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function parseAllNumbers(raw: string): number[] {
  return (raw.match(/-?\d+(?:\.\d+)?/g) ?? [])
    .map((text) => Number(text))
    .filter((value) => Number.isFinite(value));
}

function parseKeyValueBlock(raw: string): Map<string, string> {
  const map = new Map<string, string>();

  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!key) {
      continue;
    }

    map.set(key, value);
  }

  return map;
}

function parseCpuFrequencyTotals(raw: string): CpuFrequencyTotals | null {
  let sumCurrentKhz = 0;
  let sumMaxKhz = 0;
  let source: string | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith("policy ")) {
      const currentKhz = parseFirstNumber(line.match(/\bcur=([^\s]+)/)?.[1] ?? "") ?? 0;
      const maxKhz = parseFirstNumber(line.match(/\bmax=([^\s]+)/)?.[1] ?? "");
      const cpuCount = Math.max((line.match(/\bcpus=(.+)$/)?.[1] ?? "").split(/\s+/).filter(Boolean).length, 1);

      if (maxKhz === null || maxKhz <= 0) {
        continue;
      }

      sumCurrentKhz += clamp(currentKhz, 0, maxKhz) * cpuCount;
      sumMaxKhz += maxKhz * cpuCount;
      source = "cpufreq policy";
      continue;
    }

    if (line.startsWith("cpu ")) {
      const currentKhz = parseFirstNumber(line.match(/\bcur=([^\s]+)/)?.[1] ?? "") ?? 0;
      const maxKhz = parseFirstNumber(line.match(/\bmax=([^\s]+)/)?.[1] ?? "");

      if (maxKhz === null || maxKhz <= 0) {
        continue;
      }

      sumCurrentKhz += clamp(currentKhz, 0, maxKhz);
      sumMaxKhz += maxKhz;
      source = source ?? "cpufreq per-cpu";
    }
  }

  if (sumMaxKhz <= 0 || source === null) {
    return null;
  }

  return {
    sumCurrentKhz,
    sumMaxKhz,
    source
  };
}

function parseCpuTickCounters(raw: string): CpuTickCounters | null {
  const cpuLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("cpu "));

  if (!cpuLine) {
    return null;
  }

  const parts = cpuLine.split(/\s+/).slice(1).map((part) => Number(part));

  if (parts.length < 4 || parts.some((value) => !Number.isFinite(value) || value < 0)) {
    return null;
  }

  const totalTicks = parts.reduce((sum, value) => sum + value, 0);
  const idleTicks = (parts[3] ?? 0) + (parts[4] ?? 0);

  if (totalTicks <= 0) {
    return null;
  }

  return {
    totalTicks,
    idleTicks
  };
}

function parseProcessCpuTicks(raw: string): number | null {
  let totalTicks = 0;
  let found = false;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const commEnd = line.lastIndexOf(")");
    if (commEnd < 0) {
      continue;
    }

    const statParts = line.slice(commEnd + 1).trim().split(/\s+/);
    const utime = Number(statParts[11]);
    const stime = Number(statParts[12]);

    if (!Number.isFinite(utime) || !Number.isFinite(stime)) {
      continue;
    }

    totalTicks += utime + stime;
    found = true;
  }

  return found ? totalTicks : null;
}

function normalizeUtilization(rawValue: number): number | null {
  if (!Number.isFinite(rawValue)) {
    return null;
  }

  const absolute = Math.abs(rawValue);
  let normalized = absolute;

  if (absolute > 0 && absolute <= 1) {
    normalized = absolute * 100;
  } else if (absolute > 100 && absolute <= 1000) {
    normalized = absolute / 10;
  } else if (absolute > 1000 && absolute <= 10000) {
    normalized = absolute / 100;
  } else if (absolute > 10000 && absolute <= 1000000) {
    normalized = absolute / 10000;
  }

  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
    return null;
  }

  return normalized;
}

function parseBatteryTrend(batteryInfo: string): BatteryTrend {
  const statusCode = Number(batteryInfo.match(/status:\s*(\d+)/i)?.[1] ?? 0);
  const text = batteryInfo.toLowerCase();

  if (statusCode === 3 || statusCode === 4 || text.includes("discharging") || text.includes("not charging")) {
    return "discharging";
  }

  if (statusCode === 2 || statusCode === 5 || text.includes("charging") || text.includes("full")) {
    return "charging";
  }

  return "unknown";
}

function normalizeCurrentDirection(ma: number, trend: BatteryTrend): number {
  if (trend === "discharging") {
    return Math.abs(ma);
  }

  if (trend === "charging") {
    return -Math.abs(ma);
  }

  return ma;
}

function toMilliAmp(rawCurrent: number): number {
  const absolute = Math.abs(rawCurrent);

  if (absolute >= 10000) {
    return rawCurrent / 1000;
  }

  return rawCurrent;
}

function normalizeCurrentValue(raw: number | null, trend: BatteryTrend, unitHint: CurrentUnitHint): number | null {
  if (raw === null || !Number.isFinite(raw)) {
    return null;
  }

  let ma = raw;

  if (unitHint === "ua") {
    ma = raw / 1000;
  } else if (unitHint === "auto") {
    ma = toMilliAmp(raw);
  }

  const signed = normalizeCurrentDirection(ma, trend);

  if (!Number.isFinite(signed) || Math.abs(signed) < 0.01 || Math.abs(signed) > 20000) {
    return null;
  }

  return signed;
}

function parseSurfaceFlingerLatency(raw: string): SurfaceFlingerLatency {
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
  const refreshHz = refreshPeriodNs > 0 ? 1_000_000_000 / refreshPeriodNs : null;

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
      frameCompletedIndex = columns.findIndex((part) => part === "FrameCompleted");
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

function computeFrameJankMetrics(
  frameTimestampsNs: number[],
  previousFrameTimestampNs: number | null,
  source: string,
  reasons?: {
    emptyReason?: string;
    waitingReason?: string;
    noNewFramesReason?: string;
    insufficientReason?: string;
  }
): {
  jankDatum: MetricDatum;
  bigJankDatum: MetricDatum;
  latestFrameTimestampNs: number | null;
} {
  const sanitized = sanitizeSurfaceFlingerTimeline(frameTimestampsNs);
  const latestFrameTimestampNs = sanitized[sanitized.length - 1] ?? null;
  const emptyReason = reasons?.emptyReason ?? "帧时间不足，无法计算 Jank";
  const waitingReason = reasons?.waitingReason ?? "等待下一次采样计算 Jank";
  const noNewFramesReason = reasons?.noNewFramesReason ?? "当前采样无新增帧时间";
  const insufficientReason = reasons?.insufficientReason ?? "新增帧不足以判断 Jank";

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

  for (let index = JANK_BASELINE_FRAME_COUNT + 1; index < sanitized.length; index += 1) {
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
    const currentFrameTimeMs = (sanitized[index] - sanitized[index - 1]) / 1_000_000;
    const previousAverageMs =
      (previousFrameTimesMs[0] + previousFrameTimesMs[1] + previousFrameTimesMs[2]) / JANK_BASELINE_FRAME_COUNT;

    if (
      previousFrameTimesMs.some((value) => !Number.isFinite(value) || value <= 0) ||
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

function isValidSurfaceFlingerTimestamp(timestampNs: number): boolean {
  return Number.isFinite(timestampNs) && timestampNs > 0 && timestampNs < SF_MAX_REASONABLE_TIMESTAMP_NS;
}

function sanitizeSurfaceFlingerTimeline(values: number[]): number[] {
  const sanitized: number[] = [];

  for (const value of values) {
    // Some ROMs emit INT64_MAX-like placeholders instead of a real frame timestamp.
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeSurfaceLayerName(rawLine: string): string {
  let layer = rawLine.trim();
  if (!layer) {
    return "";
  }

  const requestedStateMatch = layer.match(/^RequestedLayerState\{(.+)\}$/);
  if (requestedStateMatch?.[1]) {
    layer = requestedStateMatch[1].trim();
  }

  layer = layer.split(/\s(?:parentId|relativeParentId|z)=/)[0]?.trim() ?? layer;
  return layer;
}

function parseSurfaceFlingerLayers(raw: string): string[] {
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

function scoreSurfaceLayer(layer: string, packageName?: string): number {
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

function createAdapterCandidate(params: {
  key: string;
  label: string;
  vendor: string;
  source: string;
  unit: string;
  supported: boolean;
  value: number | null;
  reason?: string;
}): CapabilityAdapter {
  return {
    key: params.key,
    label: params.label,
    vendor: params.vendor,
    source: params.source,
    unit: params.unit,
    supported: params.supported,
    selected: false,
    value: params.value,
    reason: params.reason
  };
}

function toCapabilityGroup(fallbackVendor: string, adapters: CapabilityAdapter[]): CapabilityGroup {
  const selectedIndex = adapters.findIndex((adapter) => adapter.supported);
  const selectedAdapterKey = selectedIndex >= 0 ? adapters[selectedIndex].key : null;
  const vendor = selectedIndex >= 0 ? adapters[selectedIndex].vendor : fallbackVendor;

  return {
    vendor,
    selectedAdapterKey,
    adapters: adapters.map((adapter, index) => ({
      ...adapter,
      selected: index === selectedIndex
    }))
  };
}

function appendCandidateIfMissing(
  candidates: Array<{ layer: string; score: number; packageMatch: boolean }>,
  layerName: string,
  packageName: string
): void {
  if (candidates.some((candidate) => candidate.layer === layerName)) {
    return;
  }

  candidates.push({
    layer: layerName,
    score: scoreSurfaceLayer(layerName, packageName),
    packageMatch: layerName.toLowerCase().includes(packageName.toLowerCase())
  });
}

function buildLayerCandidates(
  rankedCandidates: Array<{ layer: string; score: number; packageMatch: boolean }>,
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

export class MetricCollector {
  private readonly previous = new Map<string, CounterSnapshot>();
  private readonly capabilityReports = new Map<string, MetricCapabilityReport>();
  private readonly sfLockStates = new Map<string, SurfaceFlingerLockState>();

  constructor(private readonly adb: AdbClient) {}

  reset(serial: string, packageName: string): void {
    const key = `${serial}::${packageName}`;

    this.previous.delete(key);
    this.capabilityReports.delete(key);
    this.sfLockStates.delete(key);
  }

  async collect(
    serial: string,
    packageName: string,
    fpsMode: FpsMode = "surfaceflinger",
    cpuMode: CpuUsageMode = "traditional"
  ): Promise<MetricCollectResult> {
    const timestamp = Date.now();
    const key = `${serial}::${packageName}`;

    const prev = this.previous.get(key);

    if (!prev) {
      this.sfLockStates.delete(key);
    }

    // Collect FPS first because SurfaceFlinger/gfxinfo are more timing-sensitive than the other shell probes.
    const gfxInfo =
      fpsMode === "gfxinfo" ? await this.adb.shellAllowFailure(serial, `dumpsys gfxinfo ${packageName}`) : "";
    const fpsResult = await this.collectFps(key, serial, packageName, fpsMode, gfxInfo, prev, timestamp);

    const [
      cpuStatInfo,
      processCpuStatInfo,
      cpuFrequencyInfo,
      memInfo,
      batteryInfo,
      netDevInfo,
      diskStatsInfo,
      currentNow,
      currentAvg,
      currentMa,
      batteryAverageCurrent,
      fgCurrent,
      battCurrentUaNow,
      powerNow,
      voltageNow,
      chargeCounter,
      kgslBusyPercentage,
      kgslGpubusy,
      kgslCurFreq,
      kgslMaxFreq,
      mtkGedGpuLoading,
      mtkGedGpuUtilization,
      mtkGpufreqVarDump,
      samsungMaliUtilization,
      maliUtilization,
      exynosMaliUtilization,
      devfreqProbe
    ] = await Promise.all([
      this.adb.shellAllowFailure(serial, "cat /proc/stat"),
      this.adb.shellAllowFailure(serial, buildProcessCpuStatCommand(packageName)),
      this.adb.shellAllowFailure(serial, CPU_FREQ_PROBE_COMMAND),
      this.adb.shellAllowFailure(serial, `dumpsys meminfo ${packageName}`),
      this.adb.shellAllowFailure(serial, "dumpsys battery"),
      this.adb.shellAllowFailure(serial, "cat /proc/net/dev"),
      this.adb.shellAllowFailure(serial, "cat /proc/diskstats"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/power_supply/battery/current_now"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/power_supply/battery/current_avg"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/power_supply/battery/current_ma"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/power_supply/battery/BatteryAverageCurrent"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/power_supply/battery/fg_current"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/power_supply/battery/batt_current_ua_now"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/power_supply/battery/power_now"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/power_supply/battery/voltage_now"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/power_supply/battery/charge_counter"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/kgsl/kgsl-3d0/busy_percentage"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/kgsl/kgsl-3d0/gpubusy"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/kgsl/kgsl-3d0/devfreq/cur_freq"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/kgsl/kgsl-3d0/max_gpuclk"),
      this.adb.shellAllowFailure(serial, "cat /sys/kernel/ged/hal/gpu_loading"),
      this.adb.shellAllowFailure(serial, "cat /sys/kernel/ged/hal/gpu_utilization"),
      this.adb.shellAllowFailure(serial, "cat /proc/gpufreq/gpufreq_var_dump"),
      this.adb.shellAllowFailure(serial, "cat /sys/devices/platform/18500000.mali/utilization"),
      this.adb.shellAllowFailure(serial, "cat /sys/class/misc/mali0/device/utilization"),
      this.adb.shellAllowFailure(serial, "cat /sys/devices/platform/11800000.mali/utilization"),
      this.adb.shellAllowFailure(serial, DEVFREQ_GPU_PROBE_COMMAND)
    ]);
    const cpuResult = this.parseCpu(cpuStatInfo, processCpuStatInfo, prev, cpuMode, cpuFrequencyInfo);
    const memoryMetrics = this.parseMemoryMetrics(memInfo);
    const [networkRxMetric, networkTxMetric, networkTotalMetric, networkSnapshot] = this.parseNetwork(
      netDevInfo,
      prev,
      timestamp
    );
    const [diskReadMetric, diskWriteMetric, diskSnapshot] = this.parseDiskIo(diskStatsInfo, prev, timestamp);
    const temperatureMetric = this.parseTemperature(batteryInfo);
    const powerResult = this.parsePower(
      {
        batteryInfo,
        currentNow,
        currentAvg,
        currentMa,
        batteryAverageCurrent,
        fgCurrent,
        battCurrentUaNow,
        powerNow,
        voltageNow,
        chargeCounter
      },
      prev,
      timestamp
    );
    const gpuResult = this.parseGpu({
      kgslBusyPercentage,
      kgslGpubusy,
      kgslCurFreq,
      kgslMaxFreq,
      mtkGedGpuLoading,
      mtkGedGpuUtilization,
      mtkGpufreqVarDump,
      samsungMaliUtilization,
      maliUtilization,
      exynosMaliUtilization,
      devfreqProbe
    });

    this.previous.set(key, {
      timestamp,
      rxBytes: networkSnapshot.rxBytes,
      txBytes: networkSnapshot.txBytes,
      networkTotalBytes: networkSnapshot.totalBytes,
      readBytes: diskSnapshot.readBytes,
      writeBytes: diskSnapshot.writeBytes,
      cpuTotalTicks: cpuResult.cpuTotalTicks,
      cpuIdleTicks: cpuResult.cpuIdleTicks,
      cpuProcessTicks: cpuResult.cpuProcessTicks,
      frameCount: fpsResult.frameCount,
      gfxLastFrameCompletedNs: fpsResult.gfxLastFrameCompletedNs,
      sfLastPresentNs: fpsResult.sfLastPresentNs,
      sfLayerName: fpsResult.sfLayerName,
      batteryChargeUah: powerResult.chargeUah
    });

    const capabilityReport: MetricCapabilityReport = {
      serial,
      packageName,
      updatedAt: timestamp,
      fps: fpsResult.debug,
      gpu: gpuResult.group,
      power: powerResult.group
    };

    this.capabilityReports.set(key, capabilityReport);

    return {
      metrics: {
        fps: fpsResult.datum,
        jank: fpsResult.jankDatum,
        bigJank: fpsResult.bigJankDatum,
        cpu: cpuResult.appDatum,
        cpuTotal: cpuResult.totalDatum,
        memory: memoryMetrics.totalPss,
        memoryGraphics: memoryMetrics.graphics,
        memoryNativeHeap: memoryMetrics.nativeHeap,
        memoryPrivateOther: memoryMetrics.privateOther,
        networkRx: networkRxMetric,
        networkTx: networkTxMetric,
        networkTotal: networkTotalMetric,
        diskRead: diskReadMetric,
        diskWrite: diskWriteMetric,
        gpu: gpuResult.datum,
        power: powerResult.datum,
        temperature: temperatureMetric
      },
      fpsDebug: fpsResult.debug,
      capabilityReport
    };
  }

  getCapabilityReport(serial: string, packageName: string): MetricCapabilityReport | null {
    const report = this.capabilityReports.get(`${serial}::${packageName}`);
    return report ?? null;
  }

  private parseCpu(
    cpuStatInfo: string,
    processCpuStatInfo: string,
    prev: CounterSnapshot | undefined,
    cpuMode: CpuUsageMode,
    cpuFrequencyInfo: string
  ): {
    appDatum: MetricDatum;
    totalDatum: MetricDatum;
    cpuTotalTicks: number | null;
    cpuIdleTicks: number | null;
    cpuProcessTicks: number | null;
  } {
    const cpuCounters = parseCpuTickCounters(cpuStatInfo);
    const cpuTotalTicks = cpuCounters?.totalTicks ?? null;
    const cpuIdleTicks = cpuCounters?.idleTicks ?? null;
    const cpuProcessTicks = parseProcessCpuTicks(processCpuStatInfo);
    const processSource = "/proc/stat + /proc/[pid]/stat";
    const totalSource = "/proc/stat";
    const cpuFrequencies = cpuMode === "normalized" ? parseCpuFrequencyTotals(cpuFrequencyInfo) : null;
    const frequencyRatio =
      cpuMode === "normalized" && cpuFrequencies
        ? clamp(cpuFrequencies.sumCurrentKhz / cpuFrequencies.sumMaxKhz, 0, 1)
        : null;

    if (cpuTotalTicks === null || cpuIdleTicks === null) {
      return {
        appDatum: unavailable("%", "无法读取系统CPU时间", processSource),
        totalDatum: unavailable("%", "无法读取系统CPU时间", totalSource),
        cpuTotalTicks,
        cpuIdleTicks,
        cpuProcessTicks
      };
    }

    if (!prev || prev.cpuTotalTicks === null || prev.cpuIdleTicks === null) {
      return {
        appDatum:
          cpuProcessTicks === null
            ? unavailable("%", "无法读取目标进程CPU时间", processSource)
            : unavailable("%", "等待下一次采样计算CPU占用", processSource),
        totalDatum: unavailable("%", "等待下一次采样计算总CPU占用", totalSource),
        cpuTotalTicks,
        cpuIdleTicks,
        cpuProcessTicks
      };
    }

    const deltaTotalTicks = cpuTotalTicks - prev.cpuTotalTicks;
    const deltaIdleTicks = cpuIdleTicks - prev.cpuIdleTicks;

    if (deltaTotalTicks <= 0) {
      return {
        appDatum:
          cpuProcessTicks === null
            ? unavailable("%", "无法读取目标进程CPU时间", processSource)
            : unavailable("%", "系统CPU时间未推进，等待下一次采样", processSource),
        totalDatum: unavailable("%", "系统CPU时间未推进，等待下一次采样", totalSource),
        cpuTotalTicks,
        cpuIdleTicks,
        cpuProcessTicks
      };
    }

    const traditionalTotalCpuUsage = clamp(((deltaTotalTicks - Math.max(deltaIdleTicks, 0)) / deltaTotalTicks) * 100, 0, 100);

    const totalDatum =
      cpuMode === "normalized"
        ? frequencyRatio === null
          ? unavailable("%", "无法读取CPU频率，无法计算规范化总CPU占用", `${totalSource} + cpufreq`)
          : metric(round(clamp(traditionalTotalCpuUsage * frequencyRatio, 0, 100)), "%", `${totalSource} + ${cpuFrequencies?.source}`)
        : metric(round(traditionalTotalCpuUsage), "%", totalSource);

    let appDatum: MetricDatum;

    if (cpuProcessTicks === null) {
      appDatum = unavailable("%", "无法读取目标进程CPU时间", processSource);
    } else if (prev.cpuProcessTicks === null) {
      appDatum = unavailable("%", "等待下一次采样计算CPU占用", processSource);
    } else {
      const deltaProcessTicks = cpuProcessTicks - prev.cpuProcessTicks;

      if (deltaProcessTicks < 0) {
        appDatum = unavailable("%", "目标进程CPU时间回退，等待下一次采样", processSource);
      } else {
        const traditionalAppCpuUsage = clamp((deltaProcessTicks / deltaTotalTicks) * 100, 0, 100);

        appDatum =
          cpuMode === "normalized"
            ? frequencyRatio === null
              ? unavailable("%", "无法读取CPU频率，无法计算规范化CPU占用", `${processSource} + cpufreq`)
              : metric(
                  round(clamp(traditionalAppCpuUsage * frequencyRatio, 0, 100)),
                  "%",
                  `${processSource} + ${cpuFrequencies?.source}`
                )
            : metric(round(traditionalAppCpuUsage), "%", processSource);
      }
    }

    return {
      appDatum,
      totalDatum,
      cpuTotalTicks,
      cpuIdleTicks,
      cpuProcessTicks
    };
  }

  private parseMemoryMetrics(memInfo: string): {
    totalPss: MetricDatum;
    graphics: MetricDatum;
    nativeHeap: MetricDatum;
    privateOther: MetricDatum;
  } {
    const totalPssKb = this.parseMemInfoKbValue(memInfo, [/TOTAL PSS:\s*([\d,]+)/i, /^\s*TOTAL\s+([\d,]+)\s+/im]);
    const graphicsKb = this.parseNamedMemInfoKb(memInfo, "Graphics");
    const nativeHeapKb = this.parseNamedMemInfoKb(memInfo, "Native Heap");
    const privateOtherKb = this.parseNamedMemInfoKb(memInfo, "Private Other");

    return {
      totalPss: this.toMemoryMetric(totalPssKb, "PSS总内存"),
      graphics: this.toMemoryMetric(graphicsKb, "Graphics"),
      nativeHeap: this.toMemoryMetric(nativeHeapKb, "Native Heap"),
      privateOther: this.toMemoryMetric(privateOtherKb, "Private Other")
    };
  }

  private parseNamedMemInfoKb(memInfo: string, label: string): number | null {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.parseMemInfoKbValue(memInfo, [new RegExp(`^\\s*${escaped}\\s*:?\\s*([\\d,]+)\\b`, "im")]);
  }

  private parseMemInfoKbValue(memInfo: string, patterns: RegExp[]): number | null {
    for (const pattern of patterns) {
      const rawValue = memInfo.match(pattern)?.[1];
      if (!rawValue) {
        continue;
      }

      const value = Number(rawValue.replace(/,/g, ""));
      if (Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  private toMemoryMetric(kbValue: number | null, label: string): MetricDatum {
    if (kbValue === null) {
      return unavailable("MB", `无法解析${label}`, "dumpsys meminfo");
    }

    return metric(round(kbValue / 1024), "MB", "dumpsys meminfo");
  }

  private parseTemperature(batteryInfo: string): MetricDatum {
    const match = batteryInfo.match(/temperature:\s*(\d+)/i);
    if (!match?.[1]) {
      return unavailable("°C", "无法读取电池温度", "dumpsys battery");
    }

    return metric(round(Number(match[1]) / 10), "°C", "dumpsys battery");
  }

  private parsePower(powerSource: PowerSource, prev: CounterSnapshot | undefined, timestamp: number): PowerResult {
    const trend = parseBatteryTrend(powerSource.batteryInfo);
    const adapters: CapabilityAdapter[] = [];

    const currentNow = normalizeCurrentValue(parseFirstNumber(powerSource.currentNow), trend, "auto");
    adapters.push(
      createAdapterCandidate({
        key: "qcom_current_now",
        label: "current_now",
        vendor: "Qualcomm/Generic",
        source: "/sys/class/power_supply/battery/current_now",
        unit: "mA",
        supported: currentNow !== null,
        value: currentNow !== null ? round(currentNow) : null,
        reason: currentNow === null ? "不可读或数值异常" : undefined
      })
    );

    const currentAvg = normalizeCurrentValue(parseFirstNumber(powerSource.currentAvg), trend, "auto");
    adapters.push(
      createAdapterCandidate({
        key: "qcom_current_avg",
        label: "current_avg",
        vendor: "Qualcomm/Generic",
        source: "/sys/class/power_supply/battery/current_avg",
        unit: "mA",
        supported: currentAvg !== null,
        value: currentAvg !== null ? round(currentAvg) : null,
        reason: currentAvg === null ? "不可读或数值异常" : undefined
      })
    );

    const currentMa = normalizeCurrentValue(parseFirstNumber(powerSource.currentMa), trend, "ma");
    adapters.push(
      createAdapterCandidate({
        key: "generic_current_ma",
        label: "current_ma",
        vendor: "Generic",
        source: "/sys/class/power_supply/battery/current_ma",
        unit: "mA",
        supported: currentMa !== null,
        value: currentMa !== null ? round(currentMa) : null,
        reason: currentMa === null ? "不可读或数值异常" : undefined
      })
    );

    const batteryAverageCurrent = normalizeCurrentValue(parseFirstNumber(powerSource.batteryAverageCurrent), trend, "auto");
    adapters.push(
      createAdapterCandidate({
        key: "mtk_battery_average_current",
        label: "BatteryAverageCurrent",
        vendor: "MediaTek",
        source: "/sys/class/power_supply/battery/BatteryAverageCurrent",
        unit: "mA",
        supported: batteryAverageCurrent !== null,
        value: batteryAverageCurrent !== null ? round(batteryAverageCurrent) : null,
        reason: batteryAverageCurrent === null ? "不可读或数值异常" : undefined
      })
    );

    const fgCurrent = normalizeCurrentValue(parseFirstNumber(powerSource.fgCurrent), trend, "auto");
    adapters.push(
      createAdapterCandidate({
        key: "samsung_fg_current",
        label: "fg_current",
        vendor: "Samsung",
        source: "/sys/class/power_supply/battery/fg_current",
        unit: "mA",
        supported: fgCurrent !== null,
        value: fgCurrent !== null ? round(fgCurrent) : null,
        reason: fgCurrent === null ? "不可读或数值异常" : undefined
      })
    );

    const battCurrentUaNow = normalizeCurrentValue(parseFirstNumber(powerSource.battCurrentUaNow), trend, "ua");
    adapters.push(
      createAdapterCandidate({
        key: "generic_batt_current_ua_now",
        label: "batt_current_ua_now",
        vendor: "Generic",
        source: "/sys/class/power_supply/battery/batt_current_ua_now",
        unit: "mA",
        supported: battCurrentUaNow !== null,
        value: battCurrentUaNow !== null ? round(battCurrentUaNow) : null,
        reason: battCurrentUaNow === null ? "不可读或数值异常" : undefined
      })
    );

    const powerNowRaw = parseFirstNumber(powerSource.powerNow);
    const voltageNowRaw = parseFirstNumber(powerSource.voltageNow);
    const derivedByPowerVoltage =
      powerNowRaw !== null && voltageNowRaw !== null && voltageNowRaw !== 0
        ? normalizeCurrentValue((powerNowRaw / voltageNowRaw) * 1000, trend, "ma")
        : null;

    adapters.push(
      createAdapterCandidate({
        key: "generic_power_voltage",
        label: "power_now/voltage_now",
        vendor: "Generic",
        source: "/sys/class/power_supply/battery/power_now + /sys/class/power_supply/battery/voltage_now",
        unit: "mA",
        supported: derivedByPowerVoltage !== null,
        value: derivedByPowerVoltage !== null ? round(derivedByPowerVoltage) : null,
        reason:
          derivedByPowerVoltage === null
            ? "power_now/voltage_now 不可用或推导结果异常"
            : undefined
      })
    );

    const chargeUah = parseFirstNumber(powerSource.chargeCounter);
    const previousCharge = prev?.batteryChargeUah ?? null;
    const derivedByChargeCounter =
      chargeUah !== null && previousCharge !== null && prev
        ? normalizeCurrentValue((previousCharge - chargeUah) / Math.max((timestamp - prev.timestamp) / 3_600_000, 1e-6) / 1000, trend, "ma")
        : null;

    adapters.push(
      createAdapterCandidate({
        key: "generic_charge_counter_delta",
        label: "charge_counter delta",
        vendor: "Generic",
        source: "/sys/class/power_supply/battery/charge_counter",
        unit: "mA",
        supported: derivedByChargeCounter !== null,
        value: derivedByChargeCounter !== null ? round(derivedByChargeCounter) : null,
        reason:
          derivedByChargeCounter === null
            ? "需要至少两次 charge_counter 采样才能推导"
            : undefined
      })
    );

    const group = toCapabilityGroup("unknown", adapters);
    const selected = group.adapters.find((adapter) => adapter.selected && adapter.supported);

    const datum =
      selected && selected.value !== null
        ? metric(selected.value, "mA", selected.source)
        : unavailable("mA", "设备未暴露可用功耗接口", "power adapter chain");

    return {
      datum,
      chargeUah,
      group
    };
  }

  private async collectFps(
    collectionKey: string,
    serial: string,
    packageName: string,
    fpsMode: FpsMode,
    gfxInfo: string,
    prev: CounterSnapshot | undefined,
    timestamp: number
  ): Promise<FpsResult> {
    const [gfxResult, sfResult] = await Promise.all([
      Promise.resolve(this.parseGfxInfoFps(gfxInfo, prev, timestamp)),
      this.collectSurfaceFlingerFps(collectionKey, serial, packageName, prev, timestamp)
    ]);

    if (fpsMode === "surfaceflinger") {
      if (sfResult.datum.available) {
        return {
          datum: sfResult.datum,
          jankDatum: sfResult.jankDatum,
          bigJankDatum: sfResult.bigJankDatum,
          frameCount: gfxResult.frameCount,
          gfxLastFrameCompletedNs: gfxResult.latestFrameCompletedNs,
          sfLastPresentNs: sfResult.sfLastPresentNs,
          sfLayerName: sfResult.sfLayerName,
          debug: {
            requestedMode: "surfaceflinger",
            activeSource: "surfaceflinger",
            fallbackUsed: false,
            selectedLayer: sfResult.sfLayerName,
            layerSwitchReason: sfResult.layerSwitchReason,
            candidates: sfResult.candidates,
            surfaceFlingerValueMode: sfResult.valueMode,
            surfaceFlingerSampleCount: sfResult.sampleCount,
            surfaceFlingerTimelineCount: sfResult.timelineCount,
            surfaceFlingerTimelinePrimed: sfResult.timelinePrimed,
            surfaceFlingerNeedsClear: sfResult.timelineNeedsClear
          }
        };
      }

      return {
        datum: unavailable("FPS", sfResult.datum.reason ?? "SurfaceFlinger 不可用", "surfaceflinger"),
        jankDatum: sfResult.jankDatum,
        bigJankDatum: sfResult.bigJankDatum,
        frameCount: gfxResult.frameCount,
        gfxLastFrameCompletedNs: gfxResult.latestFrameCompletedNs,
        sfLastPresentNs: sfResult.sfLastPresentNs,
        sfLayerName: sfResult.sfLayerName,
        debug: {
          requestedMode: "surfaceflinger",
          activeSource: "none",
          fallbackUsed: false,
          selectedLayer: sfResult.sfLayerName,
          layerSwitchReason: sfResult.layerSwitchReason,
          candidates: sfResult.candidates,
          surfaceFlingerValueMode: sfResult.valueMode,
          surfaceFlingerSampleCount: sfResult.sampleCount,
          surfaceFlingerTimelineCount: sfResult.timelineCount,
          surfaceFlingerTimelinePrimed: sfResult.timelinePrimed,
          surfaceFlingerNeedsClear: sfResult.timelineNeedsClear
        }
      };
    }

    if (gfxResult.datum.available) {
      return {
        datum: gfxResult.datum,
        jankDatum: gfxResult.jankDatum,
        bigJankDatum: gfxResult.bigJankDatum,
        frameCount: gfxResult.frameCount,
        gfxLastFrameCompletedNs: gfxResult.latestFrameCompletedNs,
        sfLastPresentNs: sfResult.sfLastPresentNs,
        sfLayerName: sfResult.sfLayerName,
        debug: {
          requestedMode: "gfxinfo",
          activeSource: "gfxinfo",
          fallbackUsed: false,
          selectedLayer: sfResult.sfLayerName,
          layerSwitchReason: sfResult.layerSwitchReason,
          candidates: sfResult.candidates,
          surfaceFlingerValueMode: sfResult.valueMode,
          surfaceFlingerSampleCount: sfResult.sampleCount,
          surfaceFlingerTimelineCount: sfResult.timelineCount,
          surfaceFlingerTimelinePrimed: sfResult.timelinePrimed,
          surfaceFlingerNeedsClear: sfResult.timelineNeedsClear
        }
      };
    }

    if (sfResult.datum.available) {
      return {
        datum: {
          ...sfResult.datum,
          source: `${sfResult.datum.source} (gfxinfo fallback)`
        },
        jankDatum: sfResult.jankDatum,
        bigJankDatum: sfResult.bigJankDatum,
        frameCount: gfxResult.frameCount,
        gfxLastFrameCompletedNs: gfxResult.latestFrameCompletedNs,
        sfLastPresentNs: sfResult.sfLastPresentNs,
        sfLayerName: sfResult.sfLayerName,
        debug: {
          requestedMode: "gfxinfo",
          activeSource: "surfaceflinger",
          fallbackUsed: true,
          fallbackReason: gfxResult.datum.reason ?? "gfxinfo 不可用",
          selectedLayer: sfResult.sfLayerName,
          layerSwitchReason: sfResult.layerSwitchReason,
          candidates: sfResult.candidates,
          surfaceFlingerValueMode: sfResult.valueMode,
          surfaceFlingerSampleCount: sfResult.sampleCount,
          surfaceFlingerTimelineCount: sfResult.timelineCount,
          surfaceFlingerTimelinePrimed: sfResult.timelinePrimed,
          surfaceFlingerNeedsClear: sfResult.timelineNeedsClear
        }
      };
    }

    const combinedJankReason = `${gfxResult.jankDatum.reason ?? "gfxinfo Jank 不可用"}; ${sfResult.jankDatum.reason ?? "SurfaceFlinger Jank 不可用"}`;

    return {
      datum: unavailable(
        "FPS",
        `${gfxResult.datum.reason ?? "gfxinfo 不可用"}; ${sfResult.datum.reason ?? "SurfaceFlinger 不可用"}`,
        "gfxinfo -> surfaceflinger"
      ),
      jankDatum: gfxResult.jankDatum.available
        ? gfxResult.jankDatum
        : sfResult.jankDatum.available
          ? sfResult.jankDatum
          : unavailable("count", combinedJankReason, "gfxinfo -> surfaceflinger"),
      bigJankDatum: gfxResult.bigJankDatum.available
        ? gfxResult.bigJankDatum
        : sfResult.bigJankDatum.available
          ? sfResult.bigJankDatum
          : unavailable("count", combinedJankReason, "gfxinfo -> surfaceflinger"),
      frameCount: gfxResult.frameCount,
      gfxLastFrameCompletedNs: gfxResult.latestFrameCompletedNs,
      sfLastPresentNs: sfResult.sfLastPresentNs,
      sfLayerName: sfResult.sfLayerName,
      debug: {
        requestedMode: "gfxinfo",
        activeSource: "none",
        fallbackUsed: true,
        fallbackReason: `${gfxResult.datum.reason ?? "gfxinfo 不可用"}; ${sfResult.datum.reason ?? "SurfaceFlinger 不可用"}`,
        selectedLayer: sfResult.sfLayerName,
        layerSwitchReason: sfResult.layerSwitchReason,
        candidates: sfResult.candidates,
        surfaceFlingerValueMode: sfResult.valueMode,
        surfaceFlingerSampleCount: sfResult.sampleCount,
        surfaceFlingerTimelineCount: sfResult.timelineCount,
        surfaceFlingerTimelinePrimed: sfResult.timelinePrimed,
        surfaceFlingerNeedsClear: sfResult.timelineNeedsClear
      }
    };
  }

  private parseGfxInfoFps(gfxInfo: string, prev: CounterSnapshot | undefined, timestamp: number): FpsComputationResult {
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
        datum: unavailable("FPS", "无法从 gfxinfo 读取帧统计", "dumpsys gfxinfo"),
        jankDatum: jankMetrics.jankDatum,
        bigJankDatum: jankMetrics.bigJankDatum,
        frameCount: null,
        latestFrameCompletedNs: jankMetrics.latestFrameTimestampNs
      };
    }

    if (!prev || prev.frameCount === null) {
      return {
        datum: unavailable("FPS", "等待下一次采样计算 FPS", "dumpsys gfxinfo"),
        jankDatum: jankMetrics.jankDatum,
        bigJankDatum: jankMetrics.bigJankDatum,
        frameCount,
        latestFrameCompletedNs: jankMetrics.latestFrameTimestampNs
      };
    }

    const deltaFrames = frameCount - prev.frameCount;
    if (deltaFrames < 0) {
      return {
        datum: unavailable("FPS", "gfxinfo 帧计数重置，等待下一次采样", "dumpsys gfxinfo"),
        jankDatum: jankMetrics.jankDatum,
        bigJankDatum: jankMetrics.bigJankDatum,
        frameCount,
        latestFrameCompletedNs: jankMetrics.latestFrameTimestampNs
      };
    }

    const deltaSeconds = Math.max((timestamp - prev.timestamp) / 1000, 0.001);
    const fpsValue = deltaFrames / deltaSeconds;
    const maxReasonableFps = 240;

    if (!Number.isFinite(fpsValue) || fpsValue < 0 || fpsValue > maxReasonableFps * 1.2) {
      return {
        datum: unavailable("FPS", "gfxinfo 计算结果异常", "dumpsys gfxinfo"),
        jankDatum: jankMetrics.jankDatum,
        bigJankDatum: jankMetrics.bigJankDatum,
        frameCount,
        latestFrameCompletedNs: jankMetrics.latestFrameTimestampNs
      };
    }

    return {
      datum: metric(round(clamp(fpsValue, 0, maxReasonableFps)), "FPS", "dumpsys gfxinfo (app scoped)"),
      jankDatum: jankMetrics.jankDatum,
      bigJankDatum: jankMetrics.bigJankDatum,
      frameCount,
      latestFrameCompletedNs: jankMetrics.latestFrameTimestampNs
    };
  }

  private async collectSurfaceFlingerFps(
    collectionKey: string,
    serial: string,
    packageName: string,
    prev: CounterSnapshot | undefined,
    sampleTimestamp: number
  ): Promise<SurfaceFlingerResult> {
    const persistedLock = this.sfLockStates.get(collectionKey);
    const lockState: SurfaceFlingerLockState = persistedLock
      ? {
          ...persistedLock,
          lockedLayerFailureCount: persistedLock.lockedLayerFailureCount ?? 0,
          timelineLayer: persistedLock.timelineLayer ?? null,
          timelineNs: sanitizeSurfaceFlingerTimeline(persistedLock.timelineNs ?? []),
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
        layerName ? `dumpsys SurfaceFlinger --latency ${layerName}` : "dumpsys SurfaceFlinger --latency",
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

    const layerListRaw = await this.adb.shellAllowFailure(serial, "dumpsys SurfaceFlinger --list");
    const layers = parseSurfaceFlingerLayers(layerListRaw);

    const rankedCandidates = layers
      .map((layer) => ({
        layer,
        score: scoreSurfaceLayer(layer, packageName),
        packageMatch: layer.toLowerCase().includes(packageName.toLowerCase())
      }))
      .sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        return b.layer.length - a.layer.length;
      });

    if (lockState.lockedLayer) {
      appendCandidateIfMissing(rankedCandidates, lockState.lockedLayer, packageName);
    }

    if (prev?.sfLayerName) {
      appendCandidateIfMissing(rankedCandidates, prev.sfLayerName, packageName);
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
        datum: unavailable("FPS", "SurfaceFlinger 未找到可用图层", "dumpsys SurfaceFlinger --list"),
        ...unavailableJankMetrics("SurfaceFlinger 未找到可用图层", "dumpsys SurfaceFlinger --latency"),
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
      const lockedCandidate = rankedCandidates.find((candidate) => candidate.layer === lockState.lockedLayer);

      if (lockState.timelineNeedsClear) {
        await this.clearSurfaceFlingerLatency(serial, lockState.lockedLayer);
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
          lockState.timelineLayer === lockState.lockedLayer ? lockState.timelineNs : [];
        const previousTimelineLast = previousTimeline[previousTimeline.length - 1] ?? null;
        const mergeMarkerIndex = previousTimelineLast !== null ? lockedProbe.presentNs.indexOf(previousTimelineLast) : -1;
        const mergedTimeline = this.mergeSurfaceFlingerTimeline(previousTimeline, lockedProbe.presentNs);
        const timelineLatestNs = mergedTimeline[mergedTimeline.length - 1] ?? lockedProbe.currentLatestNs;
        const timelineFps = this.computeSurfaceFlingerTimelineFps(mergedTimeline);
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

        const incomingNonIncreasingSteps = this.countSurfaceFlingerNonIncreasingSteps(lockedProbe.presentNs);
        const mergedNonIncreasingSteps = this.countSurfaceFlingerNonIncreasingSteps(mergedTimeline);

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
        lockState.timelineNs = this.trimSurfaceFlingerTimeline(mergedTimeline, timelineLatestNs);

        if (!lockState.timelinePrimed) {
          lockState.timelinePrimed = true;

          if (timelineLatestNs !== null) {
            latestPresentNs = timelineLatestNs;
          } else if (lockedProbe.currentLatestNs !== null) {
            latestPresentNs = lockedProbe.currentLatestNs;
          }

          const primedJankMetrics = buildSurfaceFlingerJankMetrics(lockState.timelineNs, lockState.lockedLayer);

          this.sfLockStates.set(collectionKey, lockState);

          return {
            datum: metric(
              round(clamp(effectiveFps, 0, lockedProbe.maxReasonableFps)),
              "FPS",
              `dumpsys SurfaceFlinger --latency ${lockedProbe.layerName}`
            ),
            jankDatum: primedJankMetrics.jankDatum,
            bigJankDatum: primedJankMetrics.bigJankDatum,
            sfLastPresentNs: latestPresentNs,
            sfLayerName: lockState.lockedLayer,
            candidates: buildLayerCandidates(rankedCandidates, tried, [lockState.lockedLayer]),
            layerSwitchReason: `保持图层锁定: ${lockState.lockedLayer}（时间轴已接管）`,
            valueMode: timelineFps !== null ? "timeline" : "snapshot",
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

        this.sfLockStates.set(collectionKey, lockState);

        const lockedJankMetrics = buildSurfaceFlingerJankMetrics(mergedTimeline, lockState.lockedLayer);

        return {
          datum: metric(
            round(clamp(effectiveFps, 0, lockedProbe.maxReasonableFps)),
            "FPS",
            `dumpsys SurfaceFlinger --latency ${lockedProbe.layerName}`
          ),
          jankDatum: lockedJankMetrics.jankDatum,
          bigJankDatum: lockedJankMetrics.bigJankDatum,
          sfLastPresentNs: latestPresentNs,
          sfLayerName: lockState.lockedLayer,
          candidates: buildLayerCandidates(rankedCandidates, tried, [lockState.lockedLayer]),
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
          ? this.computeSurfaceFlingerTimelineFps(lockState.timelineNs)
          : null;

      if (retainedTimelineFps !== null) {
        this.logSurfaceFlingerLatencyRecovery({
          serial,
          layerName: lockState.lockedLayer,
          lockState,
          retainedTimelineFps,
          nextAction: "reuse-timeline"
        });
        this.sfLockStates.set(collectionKey, lockState);

        const retainedJankMetrics = buildSurfaceFlingerJankMetrics(lockState.timelineNs, lockState.lockedLayer);

        return {
          datum: metric(round(retainedTimelineFps), "FPS", `dumpsys SurfaceFlinger --latency ${lockState.lockedLayer}`),
          jankDatum: retainedJankMetrics.jankDatum,
          bigJankDatum: retainedJankMetrics.bigJankDatum,
          sfLastPresentNs: latestPresentNs,
          sfLayerName: lockState.lockedLayer,
          candidates: buildLayerCandidates(rankedCandidates, tried, [lockState.lockedLayer]),
          layerSwitchReason: `保持图层锁定: ${lockState.lockedLayer}（沿用上一时间轴）`,
          valueMode: "timeline",
          sampleCount: 0,
          timelineCount: lockState.timelineNs.length,
          timelinePrimed: lockState.timelinePrimed,
          timelineNeedsClear: lockState.timelineNeedsClear
        };
      }

      if (lockState.lockedLayerFailureCount < SF_RESELECT_ON_LOCK_FAILURE_SAMPLES) {
        this.logSurfaceFlingerLatencyRecovery({
          serial,
          layerName: lockState.lockedLayer,
          lockState,
          retainedTimelineFps,
          nextAction: "keep-lock-wait"
        });
        this.sfLockStates.set(collectionKey, lockState);

        return {
          datum: unavailable("FPS", "锁定图层暂时无有效帧数据，等待下一次采样", "dumpsys SurfaceFlinger --latency"),
          ...unavailableJankMetrics(
            "锁定图层暂时无有效帧数据，等待下一次采样",
            `dumpsys SurfaceFlinger --latency ${lockState.lockedLayer}`
          ),
          sfLastPresentNs: latestPresentNs,
          sfLayerName: lockState.lockedLayer,
          candidates: buildLayerCandidates(rankedCandidates, tried, [lockState.lockedLayer]),
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
      this.sfLockStates.set(collectionKey, lockState);

      return {
        datum: unavailable("FPS", "锁定图层持续无有效帧数据，但不会自动重选图层", "dumpsys SurfaceFlinger --latency"),
        ...unavailableJankMetrics(
          "锁定图层持续无有效帧数据，但不会自动重选图层",
          `dumpsys SurfaceFlinger --latency ${lockState.lockedLayer}`
        ),
        sfLastPresentNs: latestPresentNs,
        sfLayerName: lockState.lockedLayer,
        candidates: buildLayerCandidates(rankedCandidates, tried, [lockState.lockedLayer]),
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
    const candidateMap = new Map(rankedCandidates.map((candidate) => [candidate.layer, candidate]));

    if (lockState.lockedLayer) {
      attemptOrder.push(lockState.lockedLayer);
      attemptSet.add(lockState.lockedLayer);
    }

    if (prev?.sfLayerName) {
      attemptOrder.push(prev.sfLayerName);
      attemptSet.add(prev.sfLayerName);
    }

    for (const candidate of rankedCandidates.filter((item) => item.packageMatch).slice(0, 12)) {
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
    const preferredLayer = lockState.lockedLayer ?? prev?.sfLayerName ?? null;

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

      const currentLatest = latency.presentNs[latency.presentNs.length - 1] ?? null;
      if (currentLatest !== null) {
        latestPresentNs = currentLatest;
      }

      const fpsValue = this.computeSurfaceFlingerFps(latency, prev, layerName);
      const maxReasonableFps = latency.refreshHz ? latency.refreshHz * 1.2 : 240;

      if (fpsValue === null || !Number.isFinite(fpsValue) || fpsValue < 0 || fpsValue > maxReasonableFps * 1.5) {
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

      if (currentLatest !== null && (latestPresentNs === null || currentLatest > latestPresentNs)) {
        latestPresentNs = currentLatest;
      }
    }

    const probeList = Array.from(probes.values());
    if (probeList.length === 0) {
      this.sfLockStates.set(collectionKey, lockState);

      return {
        datum: unavailable("FPS", "SurfaceFlinger 帧时间不足，等待后续采样", "dumpsys SurfaceFlinger --latency"),
        ...unavailableJankMetrics("SurfaceFlinger 帧时间不足，等待后续采样", "dumpsys SurfaceFlinger --latency"),
        sfLastPresentNs: latestPresentNs,
        sfLayerName: lockState.lockedLayer ?? prev?.sfLayerName ?? null,
        candidates: buildLayerCandidates(rankedCandidates, tried, attemptOrder),
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
          (probe) => probe.currentLatestNs !== null && freshestPresentNs - probe.currentLatestNs <= SF_MAX_STALE_NS
        )
      : probeList;
    const candidatePool = freshPool.length > 0 ? freshPool : probeList;
    const packageMatchedPool = candidatePool.filter((probe) => probe.packageMatch);
    const selectionPool = packageMatchedPool.length > 0 ? packageMatchedPool : candidatePool;

    const bestProbe = selectionPool.reduce((best, probe) =>
      this.isBetterSurfaceFlingerProbe(probe, best, preferredLayer) ? probe : best
    );

    const lockedLayer = lockState.lockedLayer;
    const lockedProbe = lockedLayer ? probes.get(lockedLayer) ?? null : null;

    let selectedProbe = bestProbe;
    let layerSwitchReason: string | undefined;

    if (!lockedLayer) {
      if (lockState.pendingLayer === bestProbe.layerName) {
        lockState.pendingCount += 1;
      } else {
        lockState.pendingLayer = bestProbe.layerName;
        lockState.pendingCount = 1;
      }

      selectedProbe = bestProbe;

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
    } else if (lockedProbe && bestProbe.layerName !== lockedProbe.layerName) {
      const switchDecision = this.decideSurfaceFlingerLayerSwitch(lockedProbe, bestProbe, lockState, sampleTimestamp);

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

    const primedLatestNs = await this.primeSurfaceFlingerTimelineAfterLock(serial, lockState, prev, selectedProbe);

    if (primedLatestNs !== null) {
      latestPresentNs = primedLatestNs;
    } else if (selectedProbe.currentLatestNs !== null) {
      latestPresentNs = selectedProbe.currentLatestNs;
    }

    this.sfLockStates.set(collectionKey, lockState);

    const selectedJankMetrics = buildSurfaceFlingerJankMetrics(selectedProbe.presentNs, selectedProbe.layerName);

    return {
      datum: metric(
        round(clamp(selectedProbe.fpsValue, 0, selectedProbe.maxReasonableFps)),
        "FPS",
        `dumpsys SurfaceFlinger --latency ${selectedProbe.layerName}`
      ),
      jankDatum: selectedJankMetrics.jankDatum,
      bigJankDatum: selectedJankMetrics.bigJankDatum,
      sfLastPresentNs: latestPresentNs,
      sfLayerName: selectedProbe.layerName,
      candidates: buildLayerCandidates(rankedCandidates, tried, attemptOrder),
      layerSwitchReason,
      valueMode: "snapshot",
      sampleCount: selectedProbe.presentNs.length,
      timelineCount: lockState.timelineNs.length,
      timelinePrimed: lockState.timelinePrimed,
      timelineNeedsClear: lockState.timelineNeedsClear
    };
  }

  private isBetterSurfaceFlingerProbe(
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
      if (current.layerName === preferredLayer && best.layerName !== preferredLayer) {
        return true;
      }

      if (best.layerName === preferredLayer && current.layerName !== preferredLayer) {
        return false;
      }
    }

    return current.fpsValue > best.fpsValue;
  }

  private decideSurfaceFlingerLayerSwitch(
    lockedProbe: SurfaceFlingerProbeResult,
    challenger: SurfaceFlingerProbeResult,
    lockState: SurfaceFlingerLockState,
    sampleTimestamp: number
  ): SurfaceFlingerSwitchDecision {
    const fpsGain = challenger.fpsValue - lockedProbe.fpsValue;
    const ratioGain = lockedProbe.fpsValue > 0 ? fpsGain / lockedProbe.fpsValue : 1;
    const hasSignificantGain =
      fpsGain >= SF_SWITCH_MIN_IMPROVEMENT_FPS || ratioGain >= SF_SWITCH_MIN_IMPROVEMENT_RATIO;
    const lowFpsEscape = lockedProbe.fpsValue <= SF_LOW_FPS_ESCAPE_THRESHOLD && fpsGain >= 4;

    if (!hasSignificantGain && !lowFpsEscape) {
      return {
        shouldSwitch: false,
        pendingLayer: null,
        pendingCount: 0,
        reason: `保持图层锁定: ${lockedProbe.layerName}（候选增益不足）`
      };
    }

    const elapsedSinceLastSwitch = sampleTimestamp - lockState.lastSwitchAt;
    if (lockState.lastSwitchAt > 0 && elapsedSinceLastSwitch < SF_SWITCH_COOLDOWN_MS) {
      return {
        shouldSwitch: false,
        pendingLayer: null,
        pendingCount: 0,
        reason: `保持图层锁定: 切换冷却中（${Math.ceil((SF_SWITCH_COOLDOWN_MS - elapsedSinceLastSwitch) / 1000)}s）`
      };
    }

    const requiredSamples = lowFpsEscape ? 1 : SF_SWITCH_CONFIRM_SAMPLES;
    const pendingCount = lockState.pendingLayer === challenger.layerName ? lockState.pendingCount + 1 : 1;

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
    const rawLines = params.rawOutput.split(/\r?\n/).map((line) => line.trimEnd());
    const numericLines = rawLines
      .map((line) => line.trim())
      .filter((line) => /^\d+(?:\s+\d+)*$/.test(line));

    console.warn("[SurfaceFlingerLatencyAnomaly]", {
      serial: params.serial,
      layerName: params.layerName,
      reason: params.reason,
      score: params.score,
      packageMatch: params.packageMatch,
      refreshHz: params.latency.refreshHz !== null ? round(params.latency.refreshHz) : null,
      presentCount: params.latency.presentNs.length,
      latestPresentNs: params.latency.presentNs[params.latency.presentNs.length - 1] ?? null,
      presentTailNs: params.latency.presentNs.slice(-8),
      fpsValue: params.fpsValue !== null && Number.isFinite(params.fpsValue) ? round(params.fpsValue) : params.fpsValue,
      maxReasonableFps: round(params.maxReasonableFps),
      prevLayerName: params.prev?.sfLayerName ?? null,
      prevLastPresentNs: params.prev?.sfLastPresentNs ?? null,
      rawLineCount: rawLines.length,
      numericLineCount: numericLines.length,
      rawPreview: rawLines.filter((line) => line.trim().length > 0).slice(0, 24).join("\n"),
      rawOutput: params.rawOutput,
      lockState: {
        lockedLayer: params.lockState.lockedLayer,
        lockedLayerFailureCount: params.lockState.lockedLayerFailureCount,
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
    nextAction: "reuse-timeline" | "keep-lock-wait" | "keep-lock-unavailable";
  }): void {
    console.warn("[SurfaceFlingerLatencyRecovery]", {
      serial: params.serial,
      layerName: params.layerName,
      nextAction: params.nextAction,
      retainedTimelineFps: params.retainedTimelineFps !== null ? round(params.retainedTimelineFps) : null,
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
      timelineFps: params.timelineFps !== null ? round(params.timelineFps) : null,
      effectiveFps: round(params.effectiveFps),
      refreshHz: params.refreshHz !== null ? round(params.refreshHz) : null,
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
        lockedLayerFailureCount: params.lockState.lockedLayerFailureCount,
        timelineLayer: params.lockState.timelineLayer,
        timelineCount: params.lockState.timelineNs.length,
        timelinePrimed: params.lockState.timelinePrimed,
        timelineNeedsClear: params.lockState.timelineNeedsClear
      },
      rawLatencyOutput: params.rawLatencyOutput
    });
  }

  private countSurfaceFlingerNonIncreasingSteps(values: number[]): number {
    let count = 0;

    for (let index = 1; index < values.length; index += 1) {
      if (values[index] <= values[index - 1]) {
        count += 1;
      }
    }

    return count;
  }

  private async primeSurfaceFlingerTimelineAfterLock(
    serial: string,
    lockState: SurfaceFlingerLockState,
    prev: CounterSnapshot | undefined,
    selectedProbe: SurfaceFlingerProbeResult
  ): Promise<number | null> {
    if (!lockState.timelineNeedsClear || !lockState.lockedLayer || lockState.lockedLayer !== selectedProbe.layerName) {
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

    const primedTimeline = this.trimSurfaceFlingerTimeline(primingProbe.presentNs, primingProbe.currentLatestNs);
    lockState.timelineLayer = lockState.lockedLayer;
    lockState.timelineNs = primedTimeline;
    lockState.timelinePrimed = primedTimeline.length > 0;

    return primedTimeline[primedTimeline.length - 1] ?? primingProbe.currentLatestNs;
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
    const maxReasonableFps = latency.refreshHz ? latency.refreshHz * 1.2 : 240;

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

    const currentLatest = latency.presentNs[latency.presentNs.length - 1] ?? null;
    const fpsValue = this.computeSurfaceFlingerFps(latency, prev, layerName);

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

  private async clearSurfaceFlingerLatency(serial: string, layerName: string): Promise<void> {
    await this.adb.shellAllowFailure(serial, `dumpsys SurfaceFlinger --latency-clear ${shellQuote(layerName)}`);
  }

  private async waitForSurfaceFlingerWarmup(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 100);
    });
  }

  private mergeSurfaceFlingerTimeline(previous: number[], incoming: number[]): number[] {
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

    return sanitizeSurfaceFlingerTimeline([...sanitizedPrevious, ...sanitizedIncoming]);
  }

  private computeSurfaceFlingerTimelineFps(timeline: number[]): number | null {
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

  private trimSurfaceFlingerTimeline(timeline: number[], latest: number | null): number[] {
    const sanitizedTimeline = sanitizeSurfaceFlingerTimeline(timeline);

    if (sanitizedTimeline.length === 0 || latest === null || !isValidSurfaceFlingerTimestamp(latest)) {
      return [];
    }

    const cutoff = latest - SF_TIMELINE_KEEP_NS;
    const trimmed = sanitizedTimeline.filter((value) => value >= cutoff);
    if (trimmed.length <= 2048) {
      return trimmed;
    }

    return trimmed.slice(trimmed.length - 2048);
  }

  private computeSurfaceFlingerFps(
    latency: SurfaceFlingerLatency,
    prev: CounterSnapshot | undefined,
    layerName: string
  ): number | null {
    if (latency.presentNs.length === 0) {
      return null;
    }

    const currentLatest = latency.presentNs[latency.presentNs.length - 1] as number;
    const oneSecondWindowNs = 1_000_000_000;
    const fromNs = currentLatest - oneSecondWindowNs;
    const framesInLastSecond = latency.presentNs.filter((value) => value > fromNs && value <= currentLatest).length;

    if (framesInLastSecond <= 0) {
      return null;
    }

    if (
      prev?.sfLayerName === layerName &&
      prev.sfLastPresentNs !== null &&
      currentLatest <= prev.sfLastPresentNs
    ) {
      // Keep a stable trailing-window estimate when timestamp stream has not advanced.
      return framesInLastSecond;
    }

    return framesInLastSecond;
  }

  private parseGpu(gpuSource: GpuSource): GpuResult {
    const adapters: CapabilityAdapter[] = [];

    const kgslBusy = normalizeUtilization(parseFirstNumber(gpuSource.kgslBusyPercentage) ?? Number.NaN);
    adapters.push(
      createAdapterCandidate({
        key: "qcom_kgsl_busy_percentage",
        label: "kgsl busy_percentage",
        vendor: "Qualcomm",
        source: "/sys/class/kgsl/kgsl-3d0/busy_percentage",
        unit: "%",
        supported: kgslBusy !== null,
        value: kgslBusy !== null ? round(kgslBusy) : null,
        reason: kgslBusy === null ? "不可读或数值异常" : undefined
      })
    );

    const gpubusyValues = parseAllNumbers(gpuSource.kgslGpubusy);
    const kgslGpubusyRatio =
      gpubusyValues.length >= 2 && gpubusyValues[1] > 0
        ? normalizeUtilization((gpubusyValues[0] / gpubusyValues[1]) * 100)
        : null;
    adapters.push(
      createAdapterCandidate({
        key: "qcom_kgsl_gpubusy_ratio",
        label: "kgsl gpubusy ratio",
        vendor: "Qualcomm",
        source: "/sys/class/kgsl/kgsl-3d0/gpubusy",
        unit: "%",
        supported: kgslGpubusyRatio !== null,
        value: kgslGpubusyRatio !== null ? round(kgslGpubusyRatio) : null,
        reason: kgslGpubusyRatio === null ? "不可读或数值异常" : undefined
      })
    );

    const mtkGpuLoading = normalizeUtilization(parseFirstNumber(gpuSource.mtkGedGpuLoading) ?? Number.NaN);
    adapters.push(
      createAdapterCandidate({
        key: "mtk_ged_gpu_loading",
        label: "ged gpu_loading",
        vendor: "MediaTek",
        source: "/sys/kernel/ged/hal/gpu_loading",
        unit: "%",
        supported: mtkGpuLoading !== null,
        value: mtkGpuLoading !== null ? round(mtkGpuLoading) : null,
        reason: mtkGpuLoading === null ? "不可读或数值异常" : undefined
      })
    );

    const mtkGpuUtilization = normalizeUtilization(parseFirstNumber(gpuSource.mtkGedGpuUtilization) ?? Number.NaN);
    adapters.push(
      createAdapterCandidate({
        key: "mtk_ged_gpu_utilization",
        label: "ged gpu_utilization",
        vendor: "MediaTek",
        source: "/sys/kernel/ged/hal/gpu_utilization",
        unit: "%",
        supported: mtkGpuUtilization !== null,
        value: mtkGpuUtilization !== null ? round(mtkGpuUtilization) : null,
        reason: mtkGpuUtilization === null ? "不可读或数值异常" : undefined
      })
    );

    const gpufreqLoadingMatch = gpuSource.mtkGpufreqVarDump.match(/g_gpu_loading\s*=\s*(\d+(?:\.\d+)?)/i);
    const mtkGpufreqDumpLoading = normalizeUtilization(gpufreqLoadingMatch ? Number(gpufreqLoadingMatch[1]) : Number.NaN);
    adapters.push(
      createAdapterCandidate({
        key: "mtk_gpufreq_dump_loading",
        label: "gpufreq dump g_gpu_loading",
        vendor: "MediaTek",
        source: "/proc/gpufreq/gpufreq_var_dump",
        unit: "%",
        supported: mtkGpufreqDumpLoading !== null,
        value: mtkGpufreqDumpLoading !== null ? round(mtkGpufreqDumpLoading) : null,
        reason: mtkGpufreqDumpLoading === null ? "不可读或数值异常" : undefined
      })
    );

    const samsungMaliUtilization = normalizeUtilization(parseFirstNumber(gpuSource.samsungMaliUtilization) ?? Number.NaN);
    adapters.push(
      createAdapterCandidate({
        key: "samsung_mali_utilization",
        label: "samsung mali utilization",
        vendor: "Samsung",
        source: "/sys/devices/platform/18500000.mali/utilization",
        unit: "%",
        supported: samsungMaliUtilization !== null,
        value: samsungMaliUtilization !== null ? round(samsungMaliUtilization) : null,
        reason: samsungMaliUtilization === null ? "不可读或数值异常" : undefined
      })
    );

    const maliUtilization = normalizeUtilization(parseFirstNumber(gpuSource.maliUtilization) ?? Number.NaN);
    adapters.push(
      createAdapterCandidate({
        key: "generic_mali_misc_utilization",
        label: "mali0 device utilization",
        vendor: "ARM Mali",
        source: "/sys/class/misc/mali0/device/utilization",
        unit: "%",
        supported: maliUtilization !== null,
        value: maliUtilization !== null ? round(maliUtilization) : null,
        reason: maliUtilization === null ? "不可读或数值异常" : undefined
      })
    );

    const exynosMaliUtilization = normalizeUtilization(parseFirstNumber(gpuSource.exynosMaliUtilization) ?? Number.NaN);
    adapters.push(
      createAdapterCandidate({
        key: "exynos_mali_utilization",
        label: "exynos mali utilization",
        vendor: "Samsung",
        source: "/sys/devices/platform/11800000.mali/utilization",
        unit: "%",
        supported: exynosMaliUtilization !== null,
        value: exynosMaliUtilization !== null ? round(exynosMaliUtilization) : null,
        reason: exynosMaliUtilization === null ? "不可读或数值异常" : undefined
      })
    );

    const devfreqMap = parseKeyValueBlock(gpuSource.devfreqProbe);
    const devfreqName = devfreqMap.get("name") || "devfreq";

    for (const key of ["gpu_load", "load", "utilization"] as const) {
      const normalized = normalizeUtilization(parseFirstNumber(devfreqMap.get(key) ?? "") ?? Number.NaN);
      adapters.push(
        createAdapterCandidate({
          key: `generic_devfreq_${key}`,
          label: `devfreq ${key}`,
          vendor: "Generic",
          source: `/sys/class/devfreq (${devfreqName}/${key})`,
          unit: "%",
          supported: normalized !== null,
          value: normalized !== null ? round(normalized) : null,
          reason: normalized === null ? "不可读或数值异常" : undefined
        })
      );
    }

    const devfreqCur = parseFirstNumber(devfreqMap.get("cur_freq") ?? "");
    const devfreqMax = parseFirstNumber(devfreqMap.get("max_freq") ?? "");
    const devfreqFreqRatio =
      devfreqCur !== null && devfreqMax !== null && devfreqMax > 0
        ? normalizeUtilization((devfreqCur / devfreqMax) * 100)
        : null;
    adapters.push(
      createAdapterCandidate({
        key: "generic_devfreq_freq_ratio",
        label: "devfreq frequency ratio",
        vendor: "Generic",
        source: `/sys/class/devfreq (${devfreqName}/cur_freq:max_freq)`,
        unit: "%",
        supported: devfreqFreqRatio !== null,
        value: devfreqFreqRatio !== null ? round(devfreqFreqRatio) : null,
        reason: devfreqFreqRatio === null ? "cur_freq/max_freq 不可读" : undefined
      })
    );

    const kgslCurFreq = parseFirstNumber(gpuSource.kgslCurFreq);
    const kgslMaxFreq = parseFirstNumber(gpuSource.kgslMaxFreq);
    const kgslFreqRatio =
      kgslCurFreq !== null && kgslMaxFreq !== null && kgslMaxFreq > 0
        ? normalizeUtilization((kgslCurFreq / kgslMaxFreq) * 100)
        : null;
    adapters.push(
      createAdapterCandidate({
        key: "qcom_kgsl_freq_ratio",
        label: "kgsl frequency ratio",
        vendor: "Qualcomm",
        source: "/sys/class/kgsl/kgsl-3d0/devfreq/cur_freq:max_gpuclk",
        unit: "%",
        supported: kgslFreqRatio !== null,
        value: kgslFreqRatio !== null ? round(kgslFreqRatio) : null,
        reason: kgslFreqRatio === null ? "cur_freq/max_gpuclk 不可读" : undefined
      })
    );

    const group = toCapabilityGroup("unknown", adapters);
    const selected = group.adapters.find((adapter) => adapter.selected && adapter.supported);

    const datum =
      selected && selected.value !== null
        ? metric(selected.value, "%", selected.source)
        : unavailable("%", "当前设备未暴露可读 GPU 利用率接口", "gpu adapter chain");

    return {
      datum,
      group
    };
  }

  private parseNetwork(
    netDevInfo: string,
    prev: CounterSnapshot | undefined,
    timestamp: number
  ): [MetricDatum, MetricDatum, MetricDatum, { rxBytes: number; txBytes: number; totalBytes: number }] {
    let rxBytes = 0;
    let txBytes = 0;
    const rateSource = "cat /proc/net/dev";
    const totalSource = "cat /proc/net/dev (session total)";

    const lines = netDevInfo
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes(":"));

    for (const line of lines) {
      const [ifaceRaw, statsRaw] = line.split(":");
      const iface = ifaceRaw.trim();
      if (!statsRaw || iface === "lo") {
        continue;
      }

      const stats = statsRaw.trim().split(/\s+/);
      if (stats.length < 9) {
        continue;
      }

      rxBytes += Number(stats[0]) || 0;
      txBytes += Number(stats[8]) || 0;
    }

    if (!prev) {
      return [
        unavailable("KB/s", "等待下一次采样计算网络速率", rateSource),
        unavailable("KB/s", "等待下一次采样计算网络速率", rateSource),
        metric(0, "MB", totalSource),
        { rxBytes, txBytes, totalBytes: 0 }
      ];
    }

    const deltaSeconds = Math.max((timestamp - prev.timestamp) / 1000, 0.001);
    const deltaRxBytes = Math.max(rxBytes - prev.rxBytes, 0);
    const deltaTxBytes = Math.max(txBytes - prev.txBytes, 0);
    const rxRate = deltaRxBytes / deltaSeconds / 1024;
    const txRate = deltaTxBytes / deltaSeconds / 1024;
    const totalBytes = prev.networkTotalBytes + deltaRxBytes + deltaTxBytes;

    return [
      metric(round(rxRate), "KB/s", rateSource),
      metric(round(txRate), "KB/s", rateSource),
      metric(round(totalBytes / 1024 / 1024), "MB", totalSource),
      { rxBytes, txBytes, totalBytes }
    ];
  }

  private parseDiskIo(
    diskStatsInfo: string,
    prev: CounterSnapshot | undefined,
    timestamp: number
  ): [MetricDatum, MetricDatum, { readBytes: number; writeBytes: number }] {
    let readSectors = 0;
    let writeSectors = 0;

    const lines = diskStatsInfo
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 10) {
        continue;
      }

      const deviceName = parts[2] || "";
      if (!DISK_NAME_REGEX.test(deviceName)) {
        continue;
      }

      readSectors += Number(parts[5]) || 0;
      writeSectors += Number(parts[9]) || 0;
    }

    const readBytes = readSectors * 512;
    const writeBytes = writeSectors * 512;

    if (!prev) {
      return [
        unavailable("KB/s", "等待下一次采样计算磁盘读速率", "cat /proc/diskstats"),
        unavailable("KB/s", "等待下一次采样计算磁盘写速率", "cat /proc/diskstats"),
        { readBytes, writeBytes }
      ];
    }

    const deltaSeconds = Math.max((timestamp - prev.timestamp) / 1000, 0.001);
    const readRate = Math.max(readBytes - prev.readBytes, 0) / deltaSeconds / 1024;
    const writeRate = Math.max(writeBytes - prev.writeBytes, 0) / deltaSeconds / 1024;

    return [
      metric(round(readRate), "KB/s", "cat /proc/diskstats"),
      metric(round(writeRate), "KB/s", "cat /proc/diskstats"),
      { readBytes, writeBytes }
    ];
  }
}
