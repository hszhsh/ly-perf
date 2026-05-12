import { useEffect, useMemo, useRef, useState } from "react";
import type { ECharts } from "echarts";
import type { MetricName, MonitorSample } from "@shared/types";
import { loadEcharts } from "@renderer/utils/loadEcharts";

export interface MetricSeries {
    name: string;
    key: MetricName;
    color: string;
}

interface MetricChartProps {
    title: string;
    samples: MonitorSample[];
    series: MetricSeries[];
    syncGroup?: string;
    onSampleFocus?: (sampleIndex: number) => void;
    onVisibleRangeChange?: (startIndex: number, endIndex: number) => void;
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function getVisibleSampleRange(
    chart: ECharts,
    sampleCount: number
): { startIndex: number; endIndex: number } {
    if (sampleCount <= 0) {
        return { startIndex: 0, endIndex: 0 };
    }

    const option = chart.getOption() as {
        dataZoom?: Array<{ start?: number; end?: number }>;
    };
    const primaryZoom = option.dataZoom?.[0];
    const startPercent = primaryZoom?.start ?? 0;
    const endPercent = primaryZoom?.end ?? 100;
    const maxIndex = sampleCount - 1;
    const startIndex = Math.max(
        0,
        Math.min(maxIndex, Math.floor((startPercent / 100) * maxIndex))
    );
    const endIndex = Math.max(
        startIndex,
        Math.min(maxIndex, Math.ceil((endPercent / 100) * maxIndex))
    );

    return { startIndex, endIndex };
}

export function MetricChart(props: MetricChartProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<HTMLDivElement | null>(null);
    const instanceRef = useRef<ECharts | null>(null);
    const [runtimeState, setRuntimeState] = useState<
        "loading" | "ready" | "error"
    >("loading");

    const option = useMemo(() => {
        const labels = props.samples.map((sample) =>
            formatTime(sample.timestamp)
        );

        return {
            backgroundColor: "transparent",
            title: {
                text: props.title,
                textStyle: {
                    color: "#d6dfeb",
                    fontSize: 14,
                    fontFamily: "Bahnschrift, Trebuchet MS, sans-serif"
                },
                left: 8,
                top: 6
            },
            tooltip: {
                trigger: "axis"
            },
            legend: {
                top: 6,
                right: 10,
                textStyle: {
                    color: "#9fb3cb",
                    fontSize: 11
                }
            },
            grid: {
                left: 50,
                right: 16,
                top: 38,
                bottom: 56
            },
            xAxis: {
                type: "category",
                data: labels,
                boundaryGap: false,
                axisLabel: {
                    color: "#8ea1b8",
                    fontSize: 10
                },
                axisLine: {
                    lineStyle: {
                        color: "rgba(118, 145, 171, 0.4)"
                    }
                }
            },
            yAxis: {
                type: "value",
                axisLabel: {
                    color: "#8ea1b8",
                    fontSize: 10
                },
                splitLine: {
                    lineStyle: {
                        color: "rgba(118, 145, 171, 0.18)"
                    }
                }
            },
            dataZoom: [
                {
                    type: "inside",
                    zoomOnMouseWheel: "ctrl",
                    moveOnMouseWheel: false
                },
                {
                    type: "slider",
                    height: 18,
                    bottom: 12
                }
            ],
            series: props.series.map((item) => ({
                type: "line",
                name: item.name,
                showSymbol: false,
                smooth: false,
                itemStyle: {
                    color: item.color
                },
                lineStyle: {
                    width: 2,
                    color: item.color
                },
                data: props.samples.map(
                    (sample) => sample.metrics[item.key]?.value ?? null
                )
            }))
        };
    }, [props.samples, props.series, props.title]);

    useEffect(() => {
        if (!chartRef.current) {
            return;
        }

        let disposed = false;
        let cleanup = () => {};

        void (async () => {
            try {
                const echarts = await loadEcharts();

                if (disposed || !chartRef.current) {
                    return;
                }

                if (!instanceRef.current) {
                    instanceRef.current = echarts.init(chartRef.current);
                }

                const chart = instanceRef.current;

                if (props.syncGroup) {
                    chart.group = props.syncGroup;
                    echarts.connect(props.syncGroup);
                }

                chart.setOption(option);

                const notifyVisibleRange = () => {
                    const range = getVisibleSampleRange(
                        chart,
                        props.samples.length
                    );
                    props.onVisibleRangeChange?.(
                        range.startIndex,
                        range.endIndex
                    );
                };
                const handleAxisPointerUpdate = (event: unknown) => {
                    const axisInfo = (
                        event as {
                            axesInfo?: Array<{ value?: number | string }>;
                        }
                    ).axesInfo?.[0];
                    const axisValue = axisInfo?.value;
                    const sampleIndex =
                        typeof axisValue === "number"
                            ? axisValue
                            : Number(axisValue);

                    if (
                        !Number.isInteger(sampleIndex) ||
                        sampleIndex < 0 ||
                        sampleIndex >= props.samples.length
                    ) {
                        return;
                    }

                    props.onSampleFocus?.(sampleIndex);
                };
                const handleChartClick = (event: unknown) => {
                    const dataIndex = (event as { dataIndex?: number })
                        .dataIndex;

                    if (typeof dataIndex !== "number") {
                        return;
                    }

                    props.onSampleFocus?.(dataIndex);
                };
                const resizeChart = () => {
                    const wrapper = wrapperRef.current;

                    if (!wrapper) {
                        chart.resize();
                        return;
                    }

                    chart.resize({
                        width: wrapper.clientWidth,
                        height: wrapper.clientHeight
                    });
                };
                const onResize = () => resizeChart();
                const resizeObserver =
                    typeof ResizeObserver === "undefined"
                        ? null
                        : new ResizeObserver(() => {
                              resizeChart();
                          });

                notifyVisibleRange();
                resizeChart();

                const wrapper = wrapperRef.current;

                if (wrapper) {
                    resizeObserver?.observe(wrapper);
                }

                chart.on("updateAxisPointer", handleAxisPointerUpdate);
                chart.on("click", handleChartClick);
                chart.on("datazoom", notifyVisibleRange);
                window.addEventListener("resize", onResize);

                cleanup = () => {
                    chart.off("updateAxisPointer", handleAxisPointerUpdate);
                    chart.off("click", handleChartClick);
                    chart.off("datazoom", notifyVisibleRange);
                    window.removeEventListener("resize", onResize);
                    resizeObserver?.disconnect();
                };

                setRuntimeState("ready");
            } catch {
                if (!disposed) {
                    setRuntimeState("error");
                }
            }
        })();

        return () => {
            disposed = true;
            cleanup();
        };
    }, [
        option,
        props.onSampleFocus,
        props.onVisibleRangeChange,
        props.samples.length,
        props.syncGroup
    ]);

    useEffect(() => {
        return () => {
            instanceRef.current?.dispose();
            instanceRef.current = null;
        };
    }, []);

    return (
        <div
            ref={wrapperRef}
            style={{
                position: "relative",
                width: "100%",
                minWidth: 0,
                height: "280px",
                overflow: "hidden"
            }}
        >
            <div
                ref={chartRef}
                style={{
                    width: "100%",
                    minWidth: 0,
                    height: "100%",
                    opacity: runtimeState === "ready" ? 1 : 0
                }}
            />
            {runtimeState !== "ready" ? (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#9fb3cb",
                        fontSize: "12px"
                    }}
                >
                    {runtimeState === "error"
                        ? "图表加载失败"
                        : "图表加载中..."}
                </div>
            ) : null}
        </div>
    );
}
