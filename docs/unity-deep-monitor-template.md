# Unity Deep Monitor Template

这份模板用于 Unity Android 项目接入 LY Perf 的深度监测协议。代码文件位于 `docs/unity/DeepMonitorUnityClientTemplate.cs`。

## 前置要求

1. Unity 项目平台为 Android。
2. Player Settings 中的 `Internet Access` 设为 `Require`。
3. 通过 Package Manager 安装 `com.unity.nuget.newtonsoft-json`。
4. 手机连接桌面端时已打开 USB 调试，且桌面端监控会话已启用深度监测。

## 模板做了什么

- 先请求固定 discovery 端点 `http://127.0.0.1:27183/deep-monitor/discovery`
- 从 discovery 文档读取当前 `stream.port` 与 `stream.sessionToken`
- 建立 raw TCP 连接并发送 `hello`
- 声明一份默认 Unity schema
- 周期推送 Unity FPS、Frame Time、Managed Heap 以及 `activeTimelineIds` 四个示例指标
- 周期发送 `heartbeat`
- 读取 `sampleAck`、`heartbeatAck` 和 `error`

## 使用方式

1. 把 `docs/unity/DeepMonitorUnityClientTemplate.cs` 复制到 Unity 项目的 `Assets/Scripts/`。
2. 挂到一个常驻 `GameObject` 上。
3. 如果需要自动连接，保持 `Connect On Start = true`。
4. 根据项目实际指标改 `CreateSchemaMessage()` 和 `CaptureMetricSnapshot()`。

## 你通常需要改的地方

1. `CreateSchemaMessage()`：把默认的 `unityFps`、`frameTimeMs`、`managedHeapMb`、`activeTimelineIds` 替换成你自己的指标和图表定义。
2. `CaptureMetricSnapshot()`：把示例采样逻辑替换成项目真实数据源；如果要上报状态类信息，可使用 `valueType = "string"` 或 `valueType = "string-list"`。
3. `sampleIntervalSeconds`：调整样本推送频率。
4. `heartbeatIntervalSeconds`：调整保活频率。

## 线程注意点

- Unity 的大部分 API 只能在主线程访问。
- 模板里把 Unity 采样放在 `Update()` 中完成，再把快照交给后台 socket 发送线程。
- 如果你要采集渲染、场景或业务状态，请继续沿用这个模式，不要在后台线程直接调用 Unity API。

## 对接建议

1. 先用模板默认指标接通一遍，确认 discovery、握手、出图都正常。
2. 再替换成项目真实指标。
3. 如果你们已有埋点系统，可以把模板里的 `CaptureMetricSnapshot()` 改成读取缓存后的业务指标字典。
4. 非数值指标在桌面端会显示成状态时间线，不会进入现有的数值折线图统计卡。