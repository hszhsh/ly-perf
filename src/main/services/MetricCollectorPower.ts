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
import type { CounterSnapshot } from "@main/services/MetricCollectorState";

export interface PowerSource {
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

export interface PowerResult {
    datum: MetricDatum;
    chargeUah: number | null;
    group: CapabilityGroup;
}

type BatteryTrend = "charging" | "discharging" | "unknown";
type CurrentUnitHint = "auto" | "ua" | "ma";

export function parseTemperatureMetric(batteryInfo: string): MetricDatum {
    const match = batteryInfo.match(/temperature:\s*(\d+)/i);
    if (!match?.[1]) {
        return unavailable("°C", "无法读取电池温度", "dumpsys battery");
    }

    return metric(round(Number(match[1]) / 10), "°C", "dumpsys battery");
}

export function parsePowerMetrics(
    powerSource: PowerSource,
    prev: CounterSnapshot | undefined,
    timestamp: number
): PowerResult {
    const trend = parseBatteryTrend(powerSource.batteryInfo);
    const adapters: CapabilityAdapter[] = [];

    const currentNow = normalizeCurrentValue(
        parseFirstNumber(powerSource.currentNow),
        trend,
        "auto"
    );
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

    const currentAvg = normalizeCurrentValue(
        parseFirstNumber(powerSource.currentAvg),
        trend,
        "auto"
    );
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

    const currentMa = normalizeCurrentValue(
        parseFirstNumber(powerSource.currentMa),
        trend,
        "ma"
    );
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

    const batteryAverageCurrent = normalizeCurrentValue(
        parseFirstNumber(powerSource.batteryAverageCurrent),
        trend,
        "auto"
    );
    adapters.push(
        createAdapterCandidate({
            key: "mtk_battery_average_current",
            label: "BatteryAverageCurrent",
            vendor: "MediaTek",
            source: "/sys/class/power_supply/battery/BatteryAverageCurrent",
            unit: "mA",
            supported: batteryAverageCurrent !== null,
            value:
                batteryAverageCurrent !== null
                    ? round(batteryAverageCurrent)
                    : null,
            reason:
                batteryAverageCurrent === null ? "不可读或数值异常" : undefined
        })
    );

    const fgCurrent = normalizeCurrentValue(
        parseFirstNumber(powerSource.fgCurrent),
        trend,
        "auto"
    );
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

    const battCurrentUaNow = normalizeCurrentValue(
        parseFirstNumber(powerSource.battCurrentUaNow),
        trend,
        "ua"
    );
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
            ? normalizeCurrentValue(
                  (powerNowRaw / voltageNowRaw) * 1000,
                  trend,
                  "ma"
              )
            : null;

    adapters.push(
        createAdapterCandidate({
            key: "generic_power_voltage",
            label: "power_now/voltage_now",
            vendor: "Generic",
            source: "/sys/class/power_supply/battery/power_now + /sys/class/power_supply/battery/voltage_now",
            unit: "mA",
            supported: derivedByPowerVoltage !== null,
            value:
                derivedByPowerVoltage !== null
                    ? round(derivedByPowerVoltage)
                    : null,
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
            ? normalizeCurrentValue(
                  (previousCharge - chargeUah) /
                      Math.max((timestamp - prev.timestamp) / 3_600_000, 1e-6) /
                      1000,
                  trend,
                  "ma"
              )
            : null;

    adapters.push(
        createAdapterCandidate({
            key: "generic_charge_counter_delta",
            label: "charge_counter delta",
            vendor: "Generic",
            source: "/sys/class/power_supply/battery/charge_counter",
            unit: "mA",
            supported: derivedByChargeCounter !== null,
            value:
                derivedByChargeCounter !== null
                    ? round(derivedByChargeCounter)
                    : null,
            reason:
                derivedByChargeCounter === null
                    ? "需要至少两次 charge_counter 采样才能推导"
                    : undefined
        })
    );

    const group = toCapabilityGroup("unknown", adapters);
    const selected = group.adapters.find(
        (adapter) => adapter.selected && adapter.supported
    );

    const datum =
        selected && selected.value !== null
            ? metric(selected.value, "mA", selected.source)
            : unavailable(
                  "mA",
                  "设备未暴露可用功耗接口",
                  "power adapter chain"
              );

    return {
        datum,
        chargeUah,
        group
    };
}

function parseBatteryTrend(batteryInfo: string): BatteryTrend {
    const statusCode = Number(batteryInfo.match(/status:\s*(\d+)/i)?.[1] ?? 0);
    const text = batteryInfo.toLowerCase();

    if (
        statusCode === 3 ||
        statusCode === 4 ||
        text.includes("discharging") ||
        text.includes("not charging")
    ) {
        return "discharging";
    }

    if (
        statusCode === 2 ||
        statusCode === 5 ||
        text.includes("charging") ||
        text.includes("full")
    ) {
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

function normalizeCurrentValue(
    raw: number | null,
    trend: BatteryTrend,
    unitHint: CurrentUnitHint
): number | null {
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

    if (
        !Number.isFinite(signed) ||
        Math.abs(signed) < 0.01 ||
        Math.abs(signed) > 20000
    ) {
        return null;
    }

    return signed;
}
