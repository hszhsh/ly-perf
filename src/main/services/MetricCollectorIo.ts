import type { MetricDatum } from "@shared/types";
import {
    metric,
    round,
    unavailable
} from "@main/services/MetricCollectorCommon";
import type { CounterSnapshot } from "@main/services/MetricCollectorState";

const DISK_NAME_REGEX = /^(mmcblk\d+|sda\d*|vda\d*|nvme\d+n\d+(p\d+)?)$/;

export interface NetworkSnapshot {
    rxBytes: number;
    txBytes: number;
    totalBytes: number;
}

export interface DiskSnapshot {
    readBytes: number;
    writeBytes: number;
}

export function parseNetworkMetrics(
    netDevInfo: string,
    prev: CounterSnapshot | undefined,
    timestamp: number
): [MetricDatum, MetricDatum, MetricDatum, NetworkSnapshot] {
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

export function parseDiskIoMetrics(
    diskStatsInfo: string,
    prev: CounterSnapshot | undefined,
    timestamp: number
): [MetricDatum, MetricDatum, DiskSnapshot] {
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
            unavailable(
                "KB/s",
                "等待下一次采样计算磁盘读速率",
                "cat /proc/diskstats"
            ),
            unavailable(
                "KB/s",
                "等待下一次采样计算磁盘写速率",
                "cat /proc/diskstats"
            ),
            { readBytes, writeBytes }
        ];
    }

    const deltaSeconds = Math.max((timestamp - prev.timestamp) / 1000, 0.001);
    const readRate =
        Math.max(readBytes - prev.readBytes, 0) / deltaSeconds / 1024;
    const writeRate =
        Math.max(writeBytes - prev.writeBytes, 0) / deltaSeconds / 1024;

    return [
        metric(round(readRate), "KB/s", "cat /proc/diskstats"),
        metric(round(writeRate), "KB/s", "cat /proc/diskstats"),
        { readBytes, writeBytes }
    ];
}
