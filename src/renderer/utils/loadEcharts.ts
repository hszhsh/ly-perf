type EChartsModule = typeof import("echarts");

let echartsPromise: Promise<EChartsModule> | null = null;

export function loadEcharts(): Promise<EChartsModule> {
    if (!echartsPromise) {
        echartsPromise = import(
            /* webpackChunkName: "echarts-runtime" */ "echarts"
        );
    }

    return echartsPromise;
}