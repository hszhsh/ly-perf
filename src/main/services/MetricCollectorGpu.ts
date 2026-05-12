import type {
    CapabilityAdapter,
    CapabilityGroup,
    MetricDatum
} from "@shared/types";
import {
    createAdapterCandidate,
    metric,
    parseFirstNumber,
    round,
    toCapabilityGroup,
    unavailable
} from "@main/services/MetricCollectorCommon";

export interface GpuResult {
    datum: MetricDatum;
    group: CapabilityGroup;
}

export interface GpuSource {
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

export const DEVFREQ_GPU_PROBE_COMMAND =
    "for d in /sys/class/devfreq/*; do " +
    'if [ -d "$d" ]; then ' +
    'name=$(cat "$d/name" 2>/dev/null); ' +
    'case "$name" in ' +
    "*[Gg][Pp][Uu]*|*[Mm]ali*|*[Aa]dreno*|*kgsl*|*3d*) " +
    'load=$(cat "$d/load" 2>/dev/null); ' +
    'gpu_load=$(cat "$d/gpu_load" 2>/dev/null); ' +
    'utilization=$(cat "$d/utilization" 2>/dev/null); ' +
    'cur_freq=$(cat "$d/cur_freq" 2>/dev/null); ' +
    'max_freq=$(cat "$d/max_freq" 2>/dev/null); ' +
    'echo "name=$name"; ' +
    'echo "load=$load"; ' +
    'echo "gpu_load=$gpu_load"; ' +
    'echo "utilization=$utilization"; ' +
    'echo "cur_freq=$cur_freq"; ' +
    'echo "max_freq=$max_freq"; ' +
    "break;; " +
    "esac; " +
    "fi; " +
    "done";

export function parseGpuMetrics(gpuSource: GpuSource): GpuResult {
    const adapters: CapabilityAdapter[] = [];

    const kgslBusy = normalizeUtilization(
        parseFirstNumber(gpuSource.kgslBusyPercentage) ?? Number.NaN
    );
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

    const mtkGpuLoading = normalizeUtilization(
        parseFirstNumber(gpuSource.mtkGedGpuLoading) ?? Number.NaN
    );
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

    const mtkGpuUtilization = normalizeUtilization(
        parseFirstNumber(gpuSource.mtkGedGpuUtilization) ?? Number.NaN
    );
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

    const gpufreqLoadingMatch = gpuSource.mtkGpufreqVarDump.match(
        /g_gpu_loading\s*=\s*(\d+(?:\.\d+)?)/i
    );
    const mtkGpufreqDumpLoading = normalizeUtilization(
        gpufreqLoadingMatch ? Number(gpufreqLoadingMatch[1]) : Number.NaN
    );
    adapters.push(
        createAdapterCandidate({
            key: "mtk_gpufreq_dump_loading",
            label: "gpufreq dump g_gpu_loading",
            vendor: "MediaTek",
            source: "/proc/gpufreq/gpufreq_var_dump",
            unit: "%",
            supported: mtkGpufreqDumpLoading !== null,
            value:
                mtkGpufreqDumpLoading !== null
                    ? round(mtkGpufreqDumpLoading)
                    : null,
            reason:
                mtkGpufreqDumpLoading === null ? "不可读或数值异常" : undefined
        })
    );

    const samsungMaliUtilization = normalizeUtilization(
        parseFirstNumber(gpuSource.samsungMaliUtilization) ?? Number.NaN
    );
    adapters.push(
        createAdapterCandidate({
            key: "samsung_mali_utilization",
            label: "samsung mali utilization",
            vendor: "Samsung",
            source: "/sys/devices/platform/18500000.mali/utilization",
            unit: "%",
            supported: samsungMaliUtilization !== null,
            value:
                samsungMaliUtilization !== null
                    ? round(samsungMaliUtilization)
                    : null,
            reason:
                samsungMaliUtilization === null ? "不可读或数值异常" : undefined
        })
    );

    const maliUtilization = normalizeUtilization(
        parseFirstNumber(gpuSource.maliUtilization) ?? Number.NaN
    );
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

    const exynosMaliUtilization = normalizeUtilization(
        parseFirstNumber(gpuSource.exynosMaliUtilization) ?? Number.NaN
    );
    adapters.push(
        createAdapterCandidate({
            key: "exynos_mali_utilization",
            label: "exynos mali utilization",
            vendor: "Samsung",
            source: "/sys/devices/platform/11800000.mali/utilization",
            unit: "%",
            supported: exynosMaliUtilization !== null,
            value:
                exynosMaliUtilization !== null
                    ? round(exynosMaliUtilization)
                    : null,
            reason:
                exynosMaliUtilization === null ? "不可读或数值异常" : undefined
        })
    );

    const devfreqMap = parseKeyValueBlock(gpuSource.devfreqProbe);
    const devfreqName = devfreqMap.get("name") || "devfreq";

    for (const key of ["gpu_load", "load", "utilization"] as const) {
        const normalized = normalizeUtilization(
            parseFirstNumber(devfreqMap.get(key) ?? "") ?? Number.NaN
        );
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
            reason:
                devfreqFreqRatio === null
                    ? "cur_freq/max_freq 不可读"
                    : undefined
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
            reason:
                kgslFreqRatio === null
                    ? "cur_freq/max_gpuclk 不可读"
                    : undefined
        })
    );

    const group = toCapabilityGroup("unknown", adapters);
    const selected = group.adapters.find(
        (adapter) => adapter.selected && adapter.supported
    );

    const datum =
        selected && selected.value !== null
            ? metric(selected.value, "%", selected.source)
            : unavailable(
                  "%",
                  "当前设备未暴露可读 GPU 利用率接口",
                  "gpu adapter chain"
              );

    return {
        datum,
        group
    };
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
