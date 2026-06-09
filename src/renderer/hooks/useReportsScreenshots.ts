import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    screenshotPreviewItems: [
        ScreenshotPreviewItem,
        ScreenshotPreviewItem,
        ScreenshotPreviewItem
    ];
    handleChartSampleFocus: (sampleIndex: number) => void;
    handleChartTimestampFocus: (timestamp: number) => void;
    jumpScreenshot: (offset: -1 | 1) => void;
}

export interface ScreenshotPreviewItem {
    kind: "previous" | "current" | "next";
    sample: SessionDetail["samples"][number] | null;
    position: number;
    url: string;
    isLoading: boolean;
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
    const [screenshotDataUrlByPath, setScreenshotDataUrlByPath] = useState<
        Record<string, string>
    >({});
    const [loadingScreenshotPaths, setLoadingScreenshotPaths] = useState<
        Record<string, boolean>
    >({});
    const isUnmountedRef = useRef(false);

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
    const previousScreenshotSample =
        selectedScreenshotPosition > 0 && sessionDetail
            ? (sessionDetail.samples[
                  screenshotSampleIndexes[selectedScreenshotPosition - 1] ?? -1
              ] ?? null)
            : null;
    const nextScreenshotSample =
        selectedScreenshotPosition >= 0 &&
        selectedScreenshotPosition < screenshotSampleIndexes.length - 1 &&
        sessionDetail
            ? (sessionDetail.samples[
                  screenshotSampleIndexes[selectedScreenshotPosition + 1] ?? -1
              ] ?? null)
            : null;

    useEffect(() => {
        isUnmountedRef.current = false;

        return () => {
            isUnmountedRef.current = true;
        };
    }, []);

    useEffect(() => {
        if (screenshotSampleIndexes.length === 0) {
            setSelectedScreenshotPosition(-1);
            return;
        }

        setSelectedScreenshotPosition(screenshotSampleIndexes.length - 1);
    }, [screenshotSampleIndexes]);

    useEffect(() => {
        const screenshotPaths = [
            previousScreenshotSample?.screenshotPath ?? "",
            selectedScreenshotSample?.screenshotPath ?? "",
            nextScreenshotSample?.screenshotPath ?? ""
        ].filter((value) => value.length > 0);

        if (screenshotPaths.length === 0) {
            return;
        }

        for (const screenshotPath of screenshotPaths) {
            if (screenshotDataUrlByPath[screenshotPath]) {
                continue;
            }

            if (loadingScreenshotPaths[screenshotPath]) {
                continue;
            }

            setLoadingScreenshotPaths((current) => ({
                ...current,
                [screenshotPath]: true
            }));

            void (async () => {
                try {
                    const dataUrl =
                        await window.lyPerf.readScreenshotDataUrl(screenshotPath);

                    if (isUnmountedRef.current) {
                        return;
                    }

                    setScreenshotDataUrlByPath((current) => ({
                        ...current,
                        [screenshotPath]: dataUrl ?? ""
                    }));
                } catch {
                    if (isUnmountedRef.current) {
                        return;
                    }

                    setScreenshotDataUrlByPath((current) => ({
                        ...current,
                        [screenshotPath]: ""
                    }));
                } finally {
                    if (isUnmountedRef.current) {
                        return;
                    }

                    setLoadingScreenshotPaths((current) => ({
                        ...current,
                        [screenshotPath]: false
                    }));
                }
            })();
        }
    }, [
        loadingScreenshotPaths,
        nextScreenshotSample,
        previousScreenshotSample,
        screenshotDataUrlByPath,
        selectedScreenshotSample
    ]);

    const screenshotPreviewItems = useMemo<
        [ScreenshotPreviewItem, ScreenshotPreviewItem, ScreenshotPreviewItem]
    >(() => {
        const previousPath = previousScreenshotSample?.screenshotPath ?? "";
        const currentPath = selectedScreenshotSample?.screenshotPath ?? "";
        const nextPath = nextScreenshotSample?.screenshotPath ?? "";

        return [
            {
                kind: "previous",
                sample: previousScreenshotSample,
                position: selectedScreenshotPosition - 1,
                url: previousPath ? (screenshotDataUrlByPath[previousPath] ?? "") : "",
                isLoading: previousPath
                    ? Boolean(loadingScreenshotPaths[previousPath])
                    : false
            },
            {
                kind: "current",
                sample: selectedScreenshotSample,
                position: selectedScreenshotPosition,
                url: currentPath ? (screenshotDataUrlByPath[currentPath] ?? "") : "",
                isLoading: currentPath
                    ? Boolean(loadingScreenshotPaths[currentPath])
                    : false
            },
            {
                kind: "next",
                sample: nextScreenshotSample,
                position: selectedScreenshotPosition + 1,
                url: nextPath ? (screenshotDataUrlByPath[nextPath] ?? "") : "",
                isLoading: nextPath
                    ? Boolean(loadingScreenshotPaths[nextPath])
                    : false
            }
        ];
    }, [
        loadingScreenshotPaths,
        nextScreenshotSample,
        previousScreenshotSample,
        screenshotDataUrlByPath,
        selectedScreenshotPosition,
        selectedScreenshotSample
    ]);

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
        screenshotPreviewItems,
        handleChartSampleFocus,
        handleChartTimestampFocus,
        jumpScreenshot
    };
}
