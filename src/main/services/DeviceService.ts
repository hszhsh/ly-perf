import type { ConnectedDevice, DeviceInfo, InstalledApp } from "@shared/types";
import { AdbClient } from "@main/adb/AdbClient";

function parseCpuModel(cpuInfoText: string, fallbackCandidates: string[]): string {
  const patterns = [
    /^Hardware\s*:\s*(.+)$/im,
    /^model name\s*:\s*(.+)$/im,
    /^Processor\s*:\s*(.+)$/im,
    /^cpu model\s*:\s*(.+)$/im
  ];

  for (const pattern of patterns) {
    const match = cpuInfoText.match(pattern);
    if (match?.[1]) {
      const normalized = match[1].replace(/\s+/g, " ").trim();
      if (!normalized || /^\d+$/.test(normalized) || /^0x[0-9a-f]+$/i.test(normalized)) {
        continue;
      }

      return normalized;
    }
  }

  return pickCpuFallback(fallbackCandidates) ?? "unknown";
}

function pickCpuFallback(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    if (/^(unknown|none|null|n\/a)$/i.test(normalized)) {
      continue;
    }

    if (/^\d+$/.test(normalized) || /^0x[0-9a-f]+$/i.test(normalized)) {
      continue;
    }

    return normalized;
  }

  return null;
}

function parseResolution(wmSizeText: string): string {
  const match = wmSizeText.match(/Physical size:\s*(\d+x\d+)/i);
  return match?.[1] ?? "unknown";
}

function parseTotalMemory(memInfoText: string): string {
  const match = memInfoText.match(/^MemTotal:\s*(\d+)\s*kB$/im);
  const totalKb = Number(match?.[1] ?? 0);

  if (!Number.isFinite(totalKb) || totalKb <= 0) {
    return "unknown";
  }

  const totalMb = totalKb / 1024;
  if (totalMb >= 1024) {
    return `${(totalMb / 1024).toFixed(2)} GB`;
  }

  return `${Math.round(totalMb)} MB`;
}

function parseIntegerProperty(raw: string): number | null {
  const value = raw.trim();

  if (!value) {
    return null;
  }

  const parsed = value.startsWith("0x") ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

const GPU_MODEL_HINT = /\b(adreno|mali|powervr|immortalis|xclipse|vivante|tegra|apple|geforce|radeon)\b/i;
const GPU_STATS_NOISE = /\b(missed frame count|frame count|frame drop|latency|jank|present time|vsync)\b/i;

function cleanGpuLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function extractGpuModelFromLine(line: string): string | null {
  const normalized = cleanGpuLine(line);
  if (!normalized || GPU_STATS_NOISE.test(normalized)) {
    return null;
  }

  const glesMatch = normalized.match(/GLES:\s*[^,]+,\s*([^,]+),/i);
  if (glesMatch?.[1]) {
    return glesMatch[1].trim();
  }

  const rendererMatch = normalized.match(/GL_RENDERER\s*[:=]\s*(.+)$/i);
  if (rendererMatch?.[1]) {
    return rendererMatch[1].trim();
  }

  const openGlMatch = normalized.match(/OpenGL(?:\s+ES)?(?:\s+\d+(?:\.\d+)*)?\s*[:=-]\s*(.+)$/i);
  if (openGlMatch?.[1]) {
    return openGlMatch[1].trim();
  }

  if (GPU_MODEL_HINT.test(normalized)) {
    return normalized;
  }

  return null;
}

function parseGpuModel(gpuText: string): string {
  if (!gpuText) {
    return "unknown";
  }

  const lines = gpuText
    .split(/\r?\n/)
    .map(cleanGpuLine)
    .filter(Boolean);

  if (lines.length === 0) {
    return "unknown";
  }

  for (const line of lines) {
    const model = extractGpuModelFromLine(line);
    if (model) {
      return model;
    }
  }

  return "unknown";
}

function parseOpenGlVersion(gpuText: string, openGlVersionProp: string): string {
  const openGlMatch = gpuText.match(/OpenGL\s+ES\s+(\d+(?:\.\d+){0,2})/i);
  if (openGlMatch?.[1]) {
    return `OpenGL ES ${openGlMatch[1]}`;
  }

  const encodedVersion = parseIntegerProperty(openGlVersionProp);
  if (encodedVersion !== null) {
    const major = encodedVersion >> 16;
    const minor = encodedVersion & 0xffff;

    if (major > 0) {
      return `OpenGL ES ${major}.${minor}`;
    }
  }

  return "unknown";
}

function parseVulkanVersion(gpuDumpText: string, vulkanVersionProp: string): string {
  const vulkanTextPatterns = [
    /Vulkan(?:\s+API)?(?:\s+version)?\s*[:=]\s*(\d+(?:\.\d+){1,2})/i,
    /apiVersion\s*[:=]\s*(\d+(?:\.\d+){1,2})/i
  ];

  for (const pattern of vulkanTextPatterns) {
    const match = gpuDumpText.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  const encodedVersion = parseIntegerProperty(vulkanVersionProp);
  if (encodedVersion !== null) {
    const major = encodedVersion >>> 22;
    const minor = (encodedVersion >>> 12) & 0x3ff;
    const patch = encodedVersion & 0xfff;

    if (major > 0) {
      return patch > 0 ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
    }
  }

  return "unknown";
}

export class DeviceService {
  constructor(private readonly adb: AdbClient) {}

  async listDevices(): Promise<ConnectedDevice[]> {
    const devices = await this.adb.listDevices();
    return devices.filter((device) => device.status === "device");
  }

  async getDeviceInfo(serial: string): Promise<DeviceInfo> {
    const [
      brand,
      manufacturer,
      model,
      androidVersion,
      sdkInt,
      cpuAbi,
      socModel,
      boardPlatform,
      hardwareName,
      bootHardware,
      cpuInfoText,
      memInfoText,
      gpuText,
      gpuPropText,
      openGlVersionProp,
      vulkanVersionProp,
      gpuDumpText,
      wmSizeText
    ] = await Promise.all([
      this.adb.getProp(serial, "ro.product.brand"),
      this.adb.getProp(serial, "ro.product.manufacturer"),
      this.adb.getProp(serial, "ro.product.model"),
      this.adb.getProp(serial, "ro.build.version.release"),
      this.adb.getProp(serial, "ro.build.version.sdk"),
      this.adb.getProp(serial, "ro.product.cpu.abi"),
      this.adb.getProp(serial, "ro.soc.model"),
      this.adb.getProp(serial, "ro.board.platform"),
      this.adb.getProp(serial, "ro.hardware"),
      this.adb.getProp(serial, "ro.boot.hardware"),
      this.adb.shellAllowFailure(serial, "cat /proc/cpuinfo"),
      this.adb.shellAllowFailure(serial, "cat /proc/meminfo"),
      this.adb.shellAllowFailure(
        serial,
        "dumpsys SurfaceFlinger | grep -m 5 -E -i 'GLES:|GL_RENDERER|OpenGL ES|Adreno|Mali|PowerVR|Immortalis|Xclipse|Vivante|Tegra'"
      ),
      this.adb.getProp(serial, "ro.hardware.egl"),
      this.adb.getProp(serial, "ro.opengles.version"),
      this.adb.getProp(serial, "ro.vulkan.version"),
      this.adb.shellAllowFailure(serial, "dumpsys gpu"),
      this.adb.shellAllowFailure(serial, "wm size")
    ]);

    return {
      serial,
      brand: brand || "unknown",
      manufacturer: manufacturer || "unknown",
      model: model || "unknown",
      androidVersion: androidVersion || "unknown",
      sdkInt: sdkInt || "unknown",
      totalMemory: parseTotalMemory(memInfoText),
      openGlVersion: parseOpenGlVersion([gpuText, gpuPropText, gpuDumpText].filter(Boolean).join("\n"), openGlVersionProp),
      vulkanVersion: parseVulkanVersion(gpuDumpText, vulkanVersionProp),
      cpuModel: parseCpuModel(cpuInfoText, [socModel, boardPlatform, hardwareName, bootHardware, cpuAbi]),
      cpuAbi: cpuAbi || "unknown",
      gpuModel: parseGpuModel([gpuText, gpuPropText, gpuDumpText].filter(Boolean).join("\n")),
      resolution: parseResolution(wmSizeText)
    };
  }

  async listInstalledApps(serial: string, keyword?: string): Promise<InstalledApp[]> {
    return this.adb.listPackages(serial, keyword);
  }
}
