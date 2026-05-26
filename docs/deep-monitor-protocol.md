# Deep Monitor TCP Protocol v1

本文档是 LY Perf 深度监测 raw TCP 协议的正式接入规范。实现侧的共享契约定义位于 `src/shared/deepMonitorProtocol.ts`；当文档示例与代码常量不一致时，以该共享契约文件为准。

## 1. 目标与范围

- 该协议用于 Android 应用将自定义性能数据主动推送到 LY Perf 桌面端。
- 传输层固定为 raw TCP，不使用 WebSocket。
- 当前唯一正式版本为 `protocolVersion = 1`。
- 当前桌面端一次监控会话只接受一个深度监测客户端连接。

## 2. 连接建立过程

### 2.1 连接前置条件

1. 用户在桌面端启用“深度监测（TCP Socket）”。
2. 桌面端监听一个 deep-monitor 数据 TCP 端口，端口号可动态分配。
3. 桌面端固定监听 discovery HTTP 端点：`http://127.0.0.1:27183/deep-monitor/discovery`。
4. 桌面端自动执行两条 adb reverse：
  - `adb reverse tcp:27183 tcp:27183`
  - `adb reverse tcp:<streamPort> tcp:<streamPort>`
5. Android 端先请求设备本地 discovery 端点，再根据 discovery 响应中的 `stream.port` 建立 raw TCP 连接。

### 2.2 建立时序

```text
Desktop Server                                 Android Client
--------------                                 --------------
listen on 127.0.0.1:<streamPort>
listen on 127.0.0.1:27183/deep-monitor/discovery
adb reverse tcp:27183 tcp:27183
adb reverse tcp:<streamPort> tcp:<streamPort>
                                               GET http://127.0.0.1:27183/deep-monitor/discovery
discovery document returned               ->    streamPort + sessionToken
                                               connect 127.0.0.1:<streamPort>
TCP connected                            <-    socket connected
waiting for first frame                  <-    hello
hello validated                          ->    helloAck
waiting for schema                       <-    schemaDeclare
schema activated                         ->    schemaAck
streaming ready                          <-    sampleBatch
samples accepted                         ->    sampleAck
optional keepalive                       <->   heartbeat / heartbeatAck
```

### 2.3 顺序要求

- Android 端应优先通过固定 discovery 端点获取 `stream.port` 和 `stream.sessionToken`。
- TCP 建连后的第一个应用层消息必须是 `hello`。
- 收到成功的 `helloAck` 之后，客户端才能发送 `schemaDeclare`。
- 收到成功的 `schemaAck` 之后，客户端才能发送与该 `schemaRevision` 对应的 `sampleBatch`。
- `heartbeat` 可以在 `helloAck` 之后任意时点发送。
- 发生协议错误时，服务端会先发送 `error`，随后主动断开 socket。

### 2.4 Discovery 通道

- Discovery 是正式的带外发现通道，传输层为 HTTP。
- 设备侧固定地址：`http://127.0.0.1:27183/deep-monitor/discovery`。
- 当前 discovery 版本固定为 `1`。
- Android 端应以 discovery 响应里的 `stream.port` 和 `stream.sessionToken` 为准，不应自行猜测数据端口。

## 3. 帧格式

- 每条协议消息都封装为一个独立 frame。
- frame header 固定 4 字节，大端无符号整数，表示 UTF-8 JSON payload 的字节长度。
- frame body 固定为 UTF-8 JSON。

```text
+----------------------+---------------------------+
| 4-byte BE uint32 len | UTF-8 JSON payload bytes |
+----------------------+---------------------------+
```

## 4. 通用字段规则

### 4.1 编码与大小写

- JSON field name 大小写敏感。
- 所有枚举值均为小写或全大写字面量，必须逐字匹配。

### 4.2 时间单位

- 所有时间戳字段都使用 Unix epoch 毫秒。

### 4.3 数字规范

- `protocolVersion`、`schemaRevision`、`sequence` 必须是有限数字。
- 桌面端对 `protocolVersion`、`schemaRevision`、`sequence` 进行向下取整。
- 采样值当前只允许 `number | string | string[] | null`。
- `number` 不允许 `NaN`、`Infinity`、字符串数字。
- `string[]` 中每个元素都必须是字符串。

### 4.4 未知字段与保留字段

- 接收方必须忽略未知的可选字段。
- 发送方在 v1 中不得依赖保留字段被消费。
- 新增字段必须保持可选，不能改变已有字段语义。

## 5. 消息定义

### 5.0 Discovery Document

Android 端通过固定 discovery 端点获取当前会话连接参数。

```json
{
  "kind": "ly-perf.deep-monitor.discovery",
  "discoveryVersion": 1,
  "serverTime": 1760000000000,
  "stream": {
    "host": "127.0.0.1",
    "port": 63983,
    "transport": "tcp",
    "socketKind": "raw-tcp",
    "protocolVersion": 1,
    "sessionToken": "1e0d3de3-a47d-4a68-b214-a97ff18cfe1c"
  },
  "session": {
    "phase": "waiting-for-client",
    "activeSchemaRevision": null
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | `"ly-perf.deep-monitor.discovery"` | 是 | discovery 文档固定类型标识。 |
| `discoveryVersion` | `number` | 是 | discovery 文档版本。当前固定为 `1`。 |
| `serverTime` | `number` | 是 | discovery 响应生成时间。 |
| `stream.host` | `"127.0.0.1"` | 是 | Android 端要连接的设备本机地址。 |
| `stream.port` | `number` | 是 | 当前 deep-monitor 数据流端口。 |
| `stream.transport` | `"tcp"` | 是 | 数据流传输层。 |
| `stream.socketKind` | `"raw-tcp"` | 是 | 数据流 socket 类型。 |
| `stream.protocolVersion` | `number` | 是 | 当前 deep-monitor 协议版本。 |
| `stream.sessionToken` | `string` | 是 | 后续 `hello.sessionToken` 必须使用这个值。 |
| `session.phase` | `DeepMonitorConnectionPhase` | 是 | 当前会话状态。 |
| `session.activeSchemaRevision` | `number \| null` | 是 | 当前生效 schema revision。 |
| `session.connectedAt` | `number` | 否 | 已有客户端连接时的时间戳。 |
| `session.negotiatedAt` | `number` | 否 | 协议协商完成时间。 |

### 5.1 通用保留字段

以下字段名在所有消息类型上保留给未来扩展，v1 实现不消费：

| 字段 | 类型 | v1 规则 |
| --- | --- | --- |
| `requestId` | `string` | 保留。可不发送；接收方必须忽略。 |
| `extensions` | `Record<string, unknown>` | 保留。用于未来扩展能力声明。 |
| `reserved` | `Record<string, unknown>` | 保留。用于未来未定字段。 |

### 5.2 Client -> Server

#### `hello`

必须作为连接后的第一个应用层消息发送。

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "sessionToken": "<authToken>"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `"hello"` | 是 | 消息类型固定值。 |
| `protocolVersion` | `number` | 是 | 协议版本。当前只接受 `1`。 |
| `sessionToken` | `string` | 是 | 桌面端侧栏展示的 `authToken`。 |
| `clientInfo` | `Record<string, unknown>` | 否 | 保留字段。 |
| `capabilities` | `string[]` | 否 | 保留字段。 |

#### `schemaDeclare`

用于声明当前自定义指标和图表布局。

```json
{
  "type": "schemaDeclare",
  "schemaRevision": 1,
  "metrics": [
    {
      "key": "renderLatencyMs",
      "label": "Render Latency",
      "unit": "ms",
      "color": "#d55454",
      "valueType": "number",
      "aggregationHint": "last",
      "description": "Frame render latency reported by the app"
    },
    {
      "key": "activeTimelineIds",
      "label": "Active Timelines",
      "unit": "",
      "color": "#ffd54f",
      "valueType": "string-list",
      "aggregationHint": "last",
      "description": "Example non-numeric state list rendered as a state timeline"
    }
  ],
  "charts": [
    {
      "id": "render-latency",
      "title": "Render Latency",
      "metricKeys": ["renderLatencyMs"],
      "order": 0,
      "yAxisLabel": "Latency",
      "yAxisUnit": "ms",
      "stats": {
        "enabled": true,
        "computations": ["max", "min", "average"],
        "scope": "visible-range",
        "surface": "reports-only"
      }
    },
    {
      "id": "active-timelines",
      "title": "Active Timelines",
      "metricKeys": ["activeTimelineIds"],
      "order": 1,
      "stats": {
        "enabled": false,
        "computations": ["max", "average"],
        "scope": "visible-range",
        "surface": "reports-only"
      }
    }
  ]
}
```

顶层字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `"schemaDeclare"` | 是 | 消息类型固定值。 |
| `schemaRevision` | `number` | 是 | 当前 schema 版本号。 |
| `metrics` | `DeepMonitorMetricDefinition[]` | 是 | 自定义指标定义集合。 |
| `charts` | `DeepMonitorChartDefinition[]` | 是 | 自定义图表定义集合。 |
| `schemaId` | `string` | 否 | 保留字段。 |
| `replaceActiveSchema` | `boolean` | 否 | 保留字段。 |

`metrics[]` 约束：

- `key` 必须非空，且在同一 `schemaRevision` 内唯一。
- `label` 必须非空。
- `unit` 允许空字符串。
- `valueType` 当前支持 `number`、`string`、`string-list`。
- `aggregationHint` 当前支持 `last`、`sum`、`average`、`max`、`min`。

`charts[]` 约束：

- `id` 必须非空，且在同一 `schemaRevision` 内唯一。
- `title` 必须非空。
- `metricKeys` 至少包含一个已声明的 metric key。
- 同一个 chart 中的 `metricKeys` 必须引用相同 `valueType` 的 metric；当前不支持在同一个 chart 中混用数值和非数值指标。
- `stats.computations` 当前只支持 `max`、`min`、`average`。
- `stats.scope` 当前支持 `visible-range`、`whole-session`。
- `stats.surface` 当前支持 `reports-only`、`monitor-and-reports`、`monitor-only`。
- 非数值 chart（`string` / `string-list`）会在桌面端显示为状态时间线，`stats.enabled` 即使传 `true` 也不会参与数值统计。

#### `sampleBatch`

用于发送一个批次的样本数据。

```json
{
  "type": "sampleBatch",
  "schemaRevision": 1,
  "samples": [
    {
      "timestamp": 1760000000000,
      "sequence": 42,
      "values": {
        "renderLatencyMs": 16.7,
        "sceneNodes": 1280,
        "textureUploadKb": 320,
        "activeTimelineIds": ["timeline/main-loop", "timeline/bonus-window"]
      }
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `"sampleBatch"` | 是 | 消息类型固定值。 |
| `schemaRevision` | `number` | 是 | 必须等于当前 active schema revision。 |
| `samples` | `DeepMonitorSampleBatchItem[]` | 是 | 采样列表。 |
| `batchId` | `string` | 否 | 保留字段。 |
| `compression` | `"none"` | 否 | 保留字段。 |

`samples[]` 约束：

- `timestamp` 必须是毫秒时间戳。
- `values` 必须是 `Record<string, number | string | string[] | null>`。
- 建议只发送当前 schema 中已声明的 metric key。
- `sequence` 为可选的单调递增序号，供客户端自校验使用。

#### `heartbeat`

保活消息，不携带业务数据。

```json
{
  "type": "heartbeat"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `"heartbeat"` | 是 | 消息类型固定值。 |
| `clientTimestamp` | `number` | 否 | 保留字段。 |

### 5.3 Server -> Client

#### `helloAck`

```json
{
  "type": "helloAck",
  "accepted": true,
  "protocolVersion": 1,
  "activeSchemaRevision": null
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `"helloAck"` | 是 | 消息类型固定值。 |
| `accepted` | `boolean` | 是 | 当前版本固定为 `true`。 |
| `protocolVersion` | `number` | 是 | 服务端实际接受的协议版本。 |
| `activeSchemaRevision` | `number \| null` | 是 | 当前生效中的 schema revision；若尚未声明则为 `null`。 |
| `serverTime` | `number` | 否 | 保留字段。 |
| `supportedProtocolVersions` | `number[]` | 否 | 保留字段。 |

#### `schemaAck`

```json
{
  "type": "schemaAck",
  "schemaRevision": 1,
  "accepted": true
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `"schemaAck"` | 是 | 消息类型固定值。 |
| `schemaRevision` | `number` | 是 | 已被接受的 schema revision。 |
| `accepted` | `boolean` | 是 | 当前版本固定为 `true`。 |
| `warnings` | `string[]` | 否 | 保留字段。 |

#### `sampleAck`

```json
{
  "type": "sampleAck",
  "acceptedCount": 1,
  "schemaRevision": 1
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `"sampleAck"` | 是 | 消息类型固定值。 |
| `acceptedCount` | `number` | 是 | 本次 batch 被接受的样本数。 |
| `schemaRevision` | `number` | 是 | 与本次 batch 对应的 schema revision。 |
| `lastAcceptedSequence` | `number` | 否 | 保留字段。 |
| `warnings` | `string[]` | 否 | 保留字段。 |

#### `heartbeatAck`

```json
{
  "type": "heartbeatAck",
  "timestamp": 1760000000500
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `"heartbeatAck"` | 是 | 消息类型固定值。 |
| `timestamp` | `number` | 是 | 服务端发送 ack 时的时间戳。 |
| `serverTime` | `number` | 否 | 保留字段。 |

#### `error`

```json
{
  "type": "error",
  "code": "HELLO_REQUIRED",
  "message": "Deep monitor protocol hello must be sent first."
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `"error"` | 是 | 消息类型固定值。 |
| `code` | `DeepMonitorProtocolErrorCode` | 是 | 稳定错误码。 |
| `message` | `string` | 是 | 面向调试的错误描述。 |
| `details` | `Record<string, unknown>` | 否 | 保留字段。 |
| `retryable` | `boolean` | 否 | 保留字段。 |

## 6. 稳定错误码清单

以下错误码为 v1 正式契约的一部分：

| 错误码 | 触发条件 | 客户端建议 |
| --- | --- | --- |
| `SESSION_BUSY` | 当前已有另一个深度监测客户端连接。 | 停止重试当前连接，等待旧连接释放。 |
| `INVALID_FRAME` | frame 长度非法或 framing 不成立。 | 检查 length-prefixed 编码。 |
| `INVALID_JSON` | frame payload 不是合法 JSON。 | 检查 UTF-8 JSON 编码。 |
| `UNSUPPORTED_MESSAGE_TYPE` | `type` 未知或不受支持。 | 修正消息类型字面量。 |
| `HELLO_REQUIRED` | 在 `hello` 前发送了其它消息。 | 按顺序先发送 `hello`。 |
| `INVALID_HELLO` | `hello` 缺少或包含非法字段。 | 检查 `protocolVersion` 与 `sessionToken`。 |
| `UNSUPPORTED_PROTOCOL_VERSION` | `protocolVersion` 不受支持。 | 降级或升级到服务端支持版本。 |
| `AUTH_TOKEN_MISMATCH` | `sessionToken` 与当前会话 token 不匹配。 | 使用 Monitor 侧栏当前会话展示的 token。 |
| `INVALID_SCHEMA` | `schemaDeclare` 字段或内容不合法。 | 修正 schema 定义后重连。 |
| `SCHEMA_REVISION_MISMATCH` | `sampleBatch.schemaRevision` 与当前 active schema 不一致。 | 先重新声明 schema，再发送样本。 |
| `INVALID_SAMPLE_BATCH` | `sampleBatch` 内样本结构或数值非法。 | 修正 batch 后重连。 |
| `INTERNAL_ERROR` | 服务端在持久化或内部处理阶段失败。 | 记录日志并允许人工重试。 |

## 7. 连接状态语义

桌面端 Monitor 侧栏展示的 `phase` 对应如下：

| phase | 含义 |
| --- | --- |
| `waiting-for-client` | 服务端已监听并完成 adb reverse，等待客户端连接。 |
| `connected` | TCP 已连接，但尚未通过应用层握手。 |
| `negotiating` | `hello` 已通过，等待 schema。 |
| `ready` | schema 已接受，可以发送 `sampleBatch`。 |
| `streaming` | 已收到样本流。 |
| `rejected` | 服务端已发送 `error` 并拒绝当前连接。 |
| `error` | socket 或服务端发生内部错误。 |
| `closed` | 监控结束，socket 已关闭。 |

## 8. 版本兼容规则

### 8.0 Discovery 版本

- 改变 discovery JSON 结构、固定路径、固定字段语义时，必须提升 `discoveryVersion`。
- 新增 discovery 字段必须保持可选。
- Android 端必须检查 `discoveryVersion`，并忽略未知的可选字段。

### 8.1 协议版本

- 破坏现有 envelope、消息类型、字段语义或握手顺序的变更，必须提升 `protocolVersion`。
- 新增字段只能以可选字段形式追加。
- 接收方必须忽略未知的可选字段与保留字段。
- 客户端必须检查 `helloAck.protocolVersion`，并以服务端接受的版本为准。

### 8.2 Schema 版本

- 自定义指标/图表布局发生语义或结构变化时，客户端必须提升 `schemaRevision`。
- 新的 `schemaRevision` 生效前，客户端不得发送引用该 revision 的 `sampleBatch`。
- 服务端只接受当前 active schema revision 对应的样本批次。

### 8.3 保留字段策略

- 保留字段名已经固定，v1 中不得假设服务端会处理其内容。
- 后续版本如启用保留字段，必须保持“旧版本接收方忽略后不影响既有行为”。

## 9. 本地联调

仓库内提供了一个 mock client，可用于验证整条链路：

```bash
npm run deep-monitor:mock
```

若需要验证 discovery 通道，先在桌面端监控侧栏确认 discovery 端点为：

```text
http://127.0.0.1:27183/deep-monitor/discovery
```

mock client 会自动请求该端点，并使用返回的 `stream.port` 和 `stream.sessionToken`。仅在需要跳过 discovery 做特殊调试时，才需要显式传 `--port` 和 `--token`。

验证通过的最低标准：

1. Monitor 侧栏 phase 进入 `streaming`。
2. Monitor 页出现并持续更新自定义图表。
3. 停止监控后，Reports 页能看到相同的自定义 schema 与样本。