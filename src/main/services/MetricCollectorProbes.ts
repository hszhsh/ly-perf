import { AdbClient } from "@main/adb/AdbClient";
import {
    buildProcessCpuStatCommand,
    CPU_FREQ_PROBE_COMMAND
} from "@main/services/MetricCollectorCpu";
import {
    DEVFREQ_GPU_PROBE_COMMAND,
    GpuSource
} from "@main/services/MetricCollectorGpu";
import { PowerSource } from "@main/services/MetricCollectorPower";

export interface MetricCollectorProbeResult {
    cpuStatInfo: string;
    processCpuStatInfo: string;
    cpuFrequencyInfo: string;
    memInfo: string;
    netDevInfo: string;
    diskStatsInfo: string;
    powerSource: PowerSource;
    gpuSource: GpuSource;
}

function buildCpuProbeCommands(
    packageName: string
): Record<"cpuStatInfo" | "processCpuStatInfo" | "cpuFrequencyInfo", string> {
    return {
        cpuStatInfo: "cat /proc/stat",
        processCpuStatInfo: buildProcessCpuStatCommand(packageName),
        cpuFrequencyInfo: CPU_FREQ_PROBE_COMMAND
    };
}

function buildMemoryProbeCommands(
    packageName: string
): Record<"memInfo", string> {
    return {
        memInfo: `dumpsys meminfo ${packageName}`
    };
}

function buildIoProbeCommands(): Record<
    "netDevInfo" | "diskStatsInfo",
    string
> {
    return {
        netDevInfo: "cat /proc/net/dev",
        diskStatsInfo: "cat /proc/diskstats"
    };
}

function buildPowerProbeCommands(): Record<keyof PowerSource, string> {
    return {
        batteryInfo: "dumpsys battery",
        currentNow: "cat /sys/class/power_supply/battery/current_now",
        currentAvg: "cat /sys/class/power_supply/battery/current_avg",
        currentMa: "cat /sys/class/power_supply/battery/current_ma",
        batteryAverageCurrent:
            "cat /sys/class/power_supply/battery/BatteryAverageCurrent",
        fgCurrent: "cat /sys/class/power_supply/battery/fg_current",
        battCurrentUaNow:
            "cat /sys/class/power_supply/battery/batt_current_ua_now",
        powerNow: "cat /sys/class/power_supply/battery/power_now",
        voltageNow: "cat /sys/class/power_supply/battery/voltage_now",
        chargeCounter: "cat /sys/class/power_supply/battery/charge_counter"
    };
}

function buildGpuProbeCommands(): Record<keyof GpuSource, string> {
    return {
        kgslBusyPercentage: "cat /sys/class/kgsl/kgsl-3d0/busy_percentage",
        kgslGpubusy: "cat /sys/class/kgsl/kgsl-3d0/gpubusy",
        kgslCurFreq: "cat /sys/class/kgsl/kgsl-3d0/devfreq/cur_freq",
        kgslMaxFreq: "cat /sys/class/kgsl/kgsl-3d0/max_gpuclk",
        mtkGedGpuLoading: "cat /sys/kernel/ged/hal/gpu_loading",
        mtkGedGpuUtilization: "cat /sys/kernel/ged/hal/gpu_utilization",
        mtkGpufreqVarDump: "cat /proc/gpufreq/gpufreq_var_dump",
        samsungMaliUtilization:
            "cat /sys/devices/platform/18500000.mali/utilization",
        maliUtilization: "cat /sys/class/misc/mali0/device/utilization",
        exynosMaliUtilization:
            "cat /sys/devices/platform/11800000.mali/utilization",
        devfreqProbe: DEVFREQ_GPU_PROBE_COMMAND
    };
}

async function collectLoggedBatch<T extends string>(
    adb: AdbClient,
    serial: string,
    label: string,
    commands: Record<T, string>,
    shouldLog: (result: Record<T, string>) => boolean
): Promise<Record<T, string>> {
    return adb.shellBatchAllowFailure(serial, commands, undefined, {
        label,
        shouldLog
    });
}

export async function collectMetricProbeOutputs(
    adb: AdbClient,
    serial: string,
    packageName: string
): Promise<MetricCollectorProbeResult> {
    const [cpuBatch, memoryBatch, ioBatch, powerBatch, gpuBatch] =
        await Promise.all([
            collectLoggedBatch(
                adb,
                serial,
                "metric-cpu",
                buildCpuProbeCommands(packageName),
                (result) => {
                    return (
                        !result.cpuStatInfo.includes("cpu ") ||
                        result.processCpuStatInfo.trim().length === 0
                    );
                }
            ),
            collectLoggedBatch(
                adb,
                serial,
                "metric-memory",
                buildMemoryProbeCommands(packageName),
                (result) => result.memInfo.trim().length === 0
            ),
            collectLoggedBatch(
                adb,
                serial,
                "metric-io",
                buildIoProbeCommands(),
                (result) => {
                    return result.netDevInfo.trim().length === 0;
                }
            ),
            collectLoggedBatch(
                adb,
                serial,
                "metric-power",
                buildPowerProbeCommands(),
                (result) => result.batteryInfo.trim().length === 0
            ),
            collectLoggedBatch(
                adb,
                serial,
                "metric-gpu",
                buildGpuProbeCommands(),
                (result) =>
                    Object.values(result).every(
                        (value) => value.trim().length === 0
                    )
            )
        ]);

    return {
        cpuStatInfo: cpuBatch.cpuStatInfo,
        processCpuStatInfo: cpuBatch.processCpuStatInfo,
        cpuFrequencyInfo: cpuBatch.cpuFrequencyInfo,
        memInfo: memoryBatch.memInfo,
        netDevInfo: ioBatch.netDevInfo,
        diskStatsInfo: ioBatch.diskStatsInfo,
        powerSource: {
            batteryInfo: powerBatch.batteryInfo,
            currentNow: powerBatch.currentNow,
            currentAvg: powerBatch.currentAvg,
            currentMa: powerBatch.currentMa,
            batteryAverageCurrent: powerBatch.batteryAverageCurrent,
            fgCurrent: powerBatch.fgCurrent,
            battCurrentUaNow: powerBatch.battCurrentUaNow,
            powerNow: powerBatch.powerNow,
            voltageNow: powerBatch.voltageNow,
            chargeCounter: powerBatch.chargeCounter
        },
        gpuSource: {
            kgslBusyPercentage: gpuBatch.kgslBusyPercentage,
            kgslGpubusy: gpuBatch.kgslGpubusy,
            kgslCurFreq: gpuBatch.kgslCurFreq,
            kgslMaxFreq: gpuBatch.kgslMaxFreq,
            mtkGedGpuLoading: gpuBatch.mtkGedGpuLoading,
            mtkGedGpuUtilization: gpuBatch.mtkGedGpuUtilization,
            mtkGpufreqVarDump: gpuBatch.mtkGpufreqVarDump,
            samsungMaliUtilization: gpuBatch.samsungMaliUtilization,
            maliUtilization: gpuBatch.maliUtilization,
            exynosMaliUtilization: gpuBatch.exynosMaliUtilization,
            devfreqProbe: gpuBatch.devfreqProbe
        }
    };
}
