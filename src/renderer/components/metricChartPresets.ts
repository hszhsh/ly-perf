import type { CpuUsageMode } from "@shared/types";
import type { MetricSeries } from "@renderer/components/MetricChart";

export const FPS_CHART_SERIES: MetricSeries[] = [
    {
        name: "FPS",
        key: "fps",
        color: "#e24a6e"
    },
    {
        name: "Jank",
        key: "jank",
        color: "#f4b860"
    },
    {
        name: "Big Jank",
        key: "bigJank",
        color: "#ff7a59"
    }
];

export function getLoadChartSeries(
    cpuMode: CpuUsageMode | undefined
): MetricSeries[] {
    return [
        {
            name:
                cpuMode === "normalized"
                    ? "App CPU Norm.(%)"
                    : "App CPU(%)",
            key: "cpu",
            color: "#5ca6ff"
        },
        {
            name:
                cpuMode === "normalized"
                    ? "Total CPU Norm.(%)"
                    : "Total CPU(%)",
            key: "cpuTotal",
            color: "#59d6d6"
        },
        {
            name: "GPU(%)",
            key: "gpu",
            color: "#7bd389"
        }
    ];
}

export const MEMORY_CHART_SERIES: MetricSeries[] = [
    {
        name: "PSS Total",
        key: "memory",
        color: "#f4b860"
    },
    {
        name: "Graphics",
        key: "memoryGraphics",
        color: "#4fc3f7"
    },
    {
        name: "Native Heap",
        key: "memoryNativeHeap",
        color: "#81c784"
    },
    {
        name: "Private Other",
        key: "memoryPrivateOther",
        color: "#ff8a65"
    }
];

export const THROUGHPUT_CHART_SERIES: MetricSeries[] = [
    {
        name: "下行 KB/s",
        key: "networkRx",
        color: "#4dd0e1"
    },
    {
        name: "上行 KB/s",
        key: "networkTx",
        color: "#26a69a"
    },
    {
        name: "Disk Read",
        key: "diskRead",
        color: "#ab47bc"
    },
    {
        name: "Disk Write",
        key: "diskWrite",
        color: "#7e57c2"
    }
];

export const THERMAL_POWER_CHART_SERIES: MetricSeries[] = [
    {
        name: "Temperature(°C)",
        key: "temperature",
        color: "#ff7043"
    },
    {
        name: "Power(mA)",
        key: "power",
        color: "#ffee58"
    }
];