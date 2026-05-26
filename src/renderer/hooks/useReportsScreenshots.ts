import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionDetail } from "@shared/types";

function findNearestIndex(indexes: number[], target: number): number {
    if (indexes.length === 0) {
        return -1;
    }

    let low = 0;
    let high = indexes.length - 1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const value = indexes[middle];

        if (value === target) {
            return middle;
        }

        if (value < target) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    if (low >= indexes.length) {
        return indexes.length - 1;
    }

    if (high < 0) {
        return 0;
    }

    const nextDistance = Math.abs(indexes[low] - target);
    const previousDistance = Math.abs(indexes[high] - target);

    return previousDistance <= nextDistance ? high : low;
}

interface UseReportsScreenshotsResult {
    screenshotSampleIndexes: number[];
    selectedScreenshotPosition: number;
    selectedScreenshotSample: SessionDetail["samples"][number] | null;
    selectedScreenshotUrl: string;
    isScreenshotLoading: boolean;
    handleChartSampleFocus: (sampleIndex: number) => void;
    handleChartTimestampFocus: (timestamp: number) => void;
    jumpScreenshot: (offset: -1 | 1) => void;
}

function findNearestSampleIndexByTimestamp(
    samples: SessionDetail["samples"],
    timestamp: number
): number {
    if (samples.length === 0) {
        return -1;
    }

    let low = 0;
    let high = samples.length - 1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const middleTimestamp = samples[middle]?.timestamp ?? 0;

        if (middleTimestamp === timestamp) {
            return middle;
        }

        if (middleTimestamp < timestamp) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    if (low >= samples.length) {
        return samples.length - 1;
    }

    if (high < 0) {
        return 0;
    }

    const nextDistance = Math.abs((samples[low]?.timestamp ?? 0) - timestamp);
    const previousDistance = Math.abs(
        (samples[high]?.timestamp ?? 0) - timestamp
    );

    return previousDistance <= nextDistance ? high : low;
}

export function useReportsScreenshots(
    sessionDetail: SessionDetail | null
): UseReportsScreenshotsResult {
    const [selectedScreenshotPosition, setSelectedScreenshotPosition] =
        useState(-1);
    const [selectedScreenshotUrl, setSelectedScreenshotUrl] = useState("");
    const [isScreenshotLoading, setIsScreenshotLoading] = useState(false);

    const screenshotSampleIndexes = useMemo(() => {
        if (!sessionDetail) {
            return [] as number[];
        }

        return sessionDetail.samples.reduce<number[]>(
            (result, sample, index) => {
                if (sample.screenshotPath) {
                    result.push(index);
                }

                return result;
            },
            []
        );
    }, [sessionDetail]);

    const selectedScreenshotSampleIndex =
        selectedScreenshotPosition >= 0
            ? (screenshotSampleIndexes[selectedScreenshotPosition] ?? null)
            : null;
    const selectedScreenshotSample =
        selectedScreenshotSampleIndex !== null && sessionDetail
            ? (sessionDetail.samples[selectedScreenshotSampleIndex] ?? null)
            : null;

    useEffect(() => {
        if (screenshotSampleIndexes.length === 0) {
            setSelectedScreenshotPosition(-1);
            return;
        }

        setSelectedScreenshotPosition(screenshotSampleIndexes.length - 1);
    }, [screenshotSampleIndexes]);

    useEffect(() => {
        let disposed = false;
        const screenshotPath = selectedScreenshotSample?.screenshotPath;

        if (!screenshotPath) {
            setSelectedScreenshotUrl("");
            setIsScreenshotLoading(false);
            return () => {
                disposed = true;
            };
        }

        setIsScreenshotLoading(true);

        void (async () => {
            try {
                const dataUrl =
                    await window.lyPerf.readScreenshotDataUrl(screenshotPath);
                if (!disposed) {
                    setSelectedScreenshotUrl(dataUrl ?? "");
                    setIsScreenshotLoading(false);
                }
            } catch {
                if (!disposed) {
                    setSelectedScreenshotUrl("");
                    setIsScreenshotLoading(false);
                }
            }
        })();

        return () => {
            disposed = true;
        };
    }, [selectedScreenshotSample]);

    const handleChartSampleFocus = useCallback((sampleIndex: number): void => {
        if (screenshotSampleIndexes.length === 0) {
            return;
        }

        const nextPosition = findNearestIndex(
            screenshotSampleIndexes,
            sampleIndex
        );
        setSelectedScreenshotPosition((current) =>
            current === nextPosition ? current : nextPosition
        );
    }, [screenshotSampleIndexes]);

    const handleChartTimestampFocus = useCallback((timestamp: number): void => {
        if (!sessionDetail || screenshotSampleIndexes.length === 0) {
            return;
        }

        const sampleIndex = findNearestSampleIndexByTimestamp(
            sessionDetail.samples,
            timestamp
        );

        if (sampleIndex < 0) {
            return;
        }

        handleChartSampleFocus(sampleIndex);
    }, [handleChartSampleFocus, screenshotSampleIndexes.length, sessionDetail]);

    function jumpScreenshot(offset: -1 | 1): void {
        setSelectedScreenshotPosition((current) => {
            if (screenshotSampleIndexes.length === 0) {
                return -1;
            }

            if (current < 0) {
                return offset > 0 ? 0 : screenshotSampleIndexes.length - 1;
            }

            const next = current + offset;
            if (next < 0 || next >= screenshotSampleIndexes.length) {
                return current;
            }

            return next;
        });
    }

    return {
        screenshotSampleIndexes,
        selectedScreenshotPosition,
        selectedScreenshotSample,
        selectedScreenshotUrl,
        isScreenshotLoading,
        handleChartSampleFocus,
        handleChartTimestampFocus,
        jumpScreenshot
    };
}
