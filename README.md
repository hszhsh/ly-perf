# LY Perf

LY Perf 是一个面向 Android 应用性能分析的桌面客户端，基于 Electron、React、TypeScript 和 Rspack 构建。它通过 ADB 连接设备，提供实时监控与历史报告两类核心能力。

## 功能概览

- 实时监控 Android 应用性能指标
- 支持设备与应用选择，并保存常用监控设置
- 支持 FPS、CPU、GPU、内存、网络等指标采集
- 支持可选的定时截图采集
- 支持历史会话查看、重命名、删除与导出
- 支持历史样本图表分析与截图回看

## 技术栈

- Electron
- React 19
- TypeScript
- Rspack
- ECharts

## 开发环境要求

- Windows
- Node.js 18+
- 可用的 Android ADB 调试环境
- Android 设备已开启开发者选项与 USB 调试

项目会将 ADB 可执行文件从 `resources/adb/win32` 打包到应用资源中。开发和打包前，请确认该目录下存在完整的 ADB 相关文件。

## 安装与启动

```bash
npm install
npm start
```

启动后，应用会同时拉起：

- renderer 开发服务器
- main 进程 watch 构建
- Electron 桌面进程

默认开发地址为 `http://localhost:3173`。

## 常用命令

```bash
npm start          # 启动本地开发环境
npm run typecheck  # TypeScript 类型检查
npm run build      # 生产构建
npm run dist       # 打包 Windows 安装产物
```

## 使用说明

### 实时监控

1. 连接 Android 设备并确保 `adb devices` 可识别。
2. 在应用中选择目标设备。
3. 选择要监控的应用包名。
4. 根据需要设置 FPS 模式、CPU 模式、采样间隔和截图选项。
5. 启动监控后查看实时图表和最新截图。

### 历史报告

1. 停止实时监控后切换到历史报告页。
2. 选择已有会话查看样本详情与图表。
3. 可对会话进行重命名、删除或导出。

## 项目结构

```text
src/
  main/       Electron 主进程、ADB 调用、IPC 注册、监控与报告服务
  preload/    预加载桥接层
  renderer/   React 页面、组件与样式
  shared/     主进程与渲染进程共享的 IPC 常量与类型定义
resources/
  adb/win32/  打包使用的 ADB 可执行文件
public/       HTML 模板等静态资源
```

## 架构说明

- `src/main` 负责 ADB、文件系统、监控采样、报告导出等主进程能力。
- `src/shared` 定义 IPC 通道和跨进程共享类型。
- `src/renderer` 负责监控页面、历史报告页面和通用 UI 组件。
- 渲染进程如需访问主进程能力，应通过 preload + IPC，而不是直接引用 main 侧模块。

## 当前页面能力

- `MonitorPage`：实时监控、设备与应用选择、监控参数设置、图表展示、最新截图预览
- `ReportsPage`：历史会话列表、指标统计、图表区间分析、截图浏览、导出与删除

## 说明

- 当前仓库以 Windows 打包为目标。
- 若设备或系统 ROM 对部分指标支持有限，界面会显示对应指标不可用。
