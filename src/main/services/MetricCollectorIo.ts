import type { MetricDatum } from "@shared/types";
import {
    metric,
    round,
    unavailable
} from "@main/services/MetricCollectorCommon";
import type { CounterSnapshot } from "@main/services/MetricCollectorState";

const DISK_NAME_REGEX = /^(mmcblk\d+|sda\d*|vda\d*|nvme\d+n\d+(p\d+)?)$/;
const EXCLUDED_NETWORK_INTERFACE_PATTERNS = [
    /^ifb\d+$/,
    /^ip6tnl\d+$/,
    /^ip_vti\d+$/,
    /^sit\d+$/,
    /^tunl\d+$/,
    /^gre\d+$/,
    /^gretap\d+$/,
    /^erspan\d+$/,
    /^bond\d+$/,
    /^dummy\d+$/,
    /^veth.+$/,
    /^virbr\d+$/,
    /^clat4$/,
    /^v4-.+$/,
    /^v6-.+$/,
    /^tun\d+$/,
    /^tap\d+$/,
    /^wg\d+$/,
    /^tailscale\d+$/,
    /^docker\d+$/,
    /^br-.+$/
];
const PREFERRED_NETWORK_INTERFACE_PATTERNS = [
    /^wlan\d+$/,
    /^swlan\d+$/,
    /^wifi\d+$/,
    /^ap\d+$/,
    /^aware_data\d+$/,
    /^eth\d+$/,
    /^en[a-z0-9]+$/,
    /^rmnet.+$/,
    /^ccmni\d+$/,
    /^pdp\d+$/,
    /^wwan\d+$/,
    /^usb\d+$/,
    /^rndis\d+$/,
    /^bt-pan$/,
    /^bnep\d+$/,
    /^ncm\d+$/
];

export interface NetworkInterfaceSnapshot {
    rxBytes: number;
    txBytes: number;
}

export interface NetworkSnapshot {
    rxBytes: number;
    txBytes: number;
    totalBytes: number;
    interfaces: Record<string, NetworkInterfaceSnapshot>;
}

export interface DiskSnapshot {
    readBytes: number;
    writeBytes: number;
}

function matchesNetworkInterfacePattern(
    interfaceName: string,
    patterns: readonly RegExp[]
): boolean {
    const normalized = interfaceName.toLowerCase();

    return patterns.some((pattern) => pattern.test(normalized));
}

function parseNetworkInterfaces(
    netDevInfo: string
): Record<string, NetworkInterfaceSnapshot> {
    const candidates = netDevInfo
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes(":"))
        .flatMap((line) => {
            const [ifaceRaw, statsRaw] = line.split(":");
            const iface = ifaceRaw.trim();

            if (!statsRaw || iface === "lo") {
                return [];
            }

            const stats = statsRaw.trim().split(/\s+/);
            if (stats.length < 9) {
                return [];
            }

            const rxBytes = Number(stats[0]);
            const txBytes = Number(stats[8]);

            if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) {
                return [];
            }

            return [
                {
                    iface,
                    rxBytes: Math.max(rxBytes, 0),
                    txBytes: Math.max(txBytes, 0)
                }
            ];
        });

    const nonExcluded = candidates.filter(
        (candidate) =>
            !matchesNetworkInterfacePattern(
                candidate.iface,
                EXCLUDED_NETWORK_INTERFACE_PATTERNS
            )
    );
    const preferred = nonExcluded.filter((candidate) =>
        matchesNetworkInterfacePattern(
            candidate.iface,
            PREFERRED_NETWORK_INTERFACE_PATTERNS
        )
    );
    const selected =
        preferred.length > 0
            ? preferred
            : nonExcluded.length > 0
              ? nonExcluded
              : candidates;

    return Object.fromEntries(
        selected.map((candidate) => [
            candidate.iface,
            {
                rxBytes: candidate.rxBytes,
                txBytes: candidate.txBytes
            }
        ])
    );
}

function sumNetworkInterfaces(
    interfaces: Record<string, NetworkInterfaceSnapshot>
): { rxBytes: number; txBytes: number } {
    let rxBytes = 0;
    let txBytes = 0;

    for (const counters of Object.values(interfaces)) {
        rxBytes += counters.rxBytes;
        txBytes += counters.txBytes;
    }

    return { rxBytes, txBytes };
}

function computeNetworkInterfaceDeltas(
    interfaces: Record<string, NetworkInterfaceSnapshot>,
    prevInterfaces: Record<string, NetworkInterfaceSnapshot> | undefined
): { deltaRxBytes: number; deltaTxBytes: number } | null {
    if (!prevInterfaces || Object.keys(prevInterfaces).length === 0) {
        return null;
    }

    let deltaRxBytes = 0;
    let deltaTxBytes = 0;

    for (const [iface, counters] of Object.entries(interfaces)) {
        const prevCounters = prevInterfaces[iface];
        if (!prevCounters) {
            continue;
        }

        deltaRxBytes += Math.max(counters.rxBytes - prevCounters.rxBytes, 0);
        deltaTxBytes += Math.max(counters.txBytes - prevCounters.txBytes, 0);
    }

    return { deltaRxBytes, deltaTxBytes };
}

export function parseNetworkMetrics(
    netDevInfo: string,
    prev: CounterSnapshot | undefined,
    timestamp: number
): [MetricDatum, MetricDatum, MetricDatum, NetworkSnapshot] {
    const interfaces = parseNetworkInterfaces(netDevInfo);
    const { rxBytes, txBytes } = sumNetworkInterfaces(interfaces);
    const rateSource = "cat /proc/net/dev";
    const totalSource = "cat /proc/net/dev (session total)";

    if (!prev) {
        return [
            unavailable("KB/s", "等待下一次采样计算网络速率", rateSource),
            unavailable("KB/s", "等待下一次采样计算网络速率", rateSource),
            metric(0, "MB", totalSource),
            { rxBytes, txBytes, totalBytes: 0, interfaces }
        ];
    }

    const deltaSeconds = Math.max((timestamp - prev.timestamp) / 1000, 0.001);
    const networkInterfaceDeltas = computeNetworkInterfaceDeltas(
        interfaces,
        prev.networkInterfaces
    );
    const deltaRxBytes = networkInterfaceDeltas
        ? networkInterfaceDeltas.deltaRxBytes
        : Math.max(rxBytes - prev.rxBytes, 0);
    const deltaTxBytes = networkInterfaceDeltas
        ? networkInterfaceDeltas.deltaTxBytes
        : Math.max(txBytes - prev.txBytes, 0);
    const rxRate = deltaRxBytes / deltaSeconds / 1024;
    const txRate = deltaTxBytes / deltaSeconds / 1024;
    const totalBytes = prev.networkTotalBytes + deltaRxBytes + deltaTxBytes;

    return [
        metric(round(rxRate), "KB/s", rateSource),
        metric(round(txRate), "KB/s", rateSource),
        metric(round(totalBytes / 1024 / 1024), "MB", totalSource),
        { rxBytes, txBytes, totalBytes, interfaces }
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
