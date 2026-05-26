using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using UnityEngine;

namespace LyPerf.Unity
{
    public class DeepMonitorUnityClientTemplate : MonoBehaviour
    {
        private const string DefaultDiscoveryUrl =
            "http://127.0.0.1:27183/deep-monitor/discovery";
        private const int ProtocolVersion = 1;
        private const int FrameHeaderSize = 4;

        private static readonly HttpClient SharedHttpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(5)
        };

        private static readonly JsonSerializerSettings JsonSettings =
            new JsonSerializerSettings
            {
                ContractResolver = new CamelCasePropertyNamesContractResolver(),
                NullValueHandling = NullValueHandling.Ignore
            };

        [SerializeField] private string discoveryUrl = DefaultDiscoveryUrl;
        [SerializeField] private bool connectOnStart = true;
        [SerializeField] private float sampleIntervalSeconds = 1.0f;
        [SerializeField] private float heartbeatIntervalSeconds = 15.0f;
        [SerializeField] private int schemaRevision = 1;
        [SerializeField] private bool logProtocolTraffic = true;

        private readonly object metricLock = new object();
        private Dictionary<string, object> latestMetricValues =
            new Dictionary<string, object>();

        private CancellationTokenSource connectionCts;
        private Task runTask;
        private TcpClient tcpClient;
        private NetworkStream networkStream;
        private int nextSequence = 1;

        public bool IsRunning => runTask != null && !runTask.IsCompleted;

        private void Awake()
        {
            CaptureMetricSnapshot();
        }

        private void Start()
        {
            if (connectOnStart)
            {
                Connect();
            }
        }

        private void Update()
        {
            CaptureMetricSnapshot();
        }

        private async void OnDisable()
        {
            await DisconnectAsync();
        }

        public void Connect()
        {
            if (IsRunning)
            {
                return;
            }

            connectionCts = new CancellationTokenSource();
            runTask = RunAsync(connectionCts.Token);
        }

        public async Task DisconnectAsync()
        {
            if (connectionCts == null)
            {
                return;
            }

            connectionCts.Cancel();

            try
            {
                if (runTask != null)
                {
                    await runTask;
                }
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[LY Perf] DisconnectAsync warning: {exception}");
            }
            finally
            {
                CleanupConnection();
                connectionCts.Dispose();
                connectionCts = null;
                runTask = null;
            }
        }

        private async Task RunAsync(CancellationToken cancellationToken)
        {
            CancellationTokenSource runCts =
                CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

            try
            {
                DeepMonitorDiscoveryDocument discovery =
                    await FetchDiscoveryDocumentAsync(runCts.Token);

                tcpClient = new TcpClient();
                await tcpClient.ConnectAsync(discovery.Stream.Host, discovery.Stream.Port);
                runCts.Token.ThrowIfCancellationRequested();

                networkStream = tcpClient.GetStream();

                await SendMessageAsync(
                    new HelloMessage
                    {
                        Type = "hello",
                        ProtocolVersion = ProtocolVersion,
                        SessionToken = discovery.Stream.SessionToken
                    },
                    runCts.Token
                );

                await ExpectMessageAsync("helloAck", runCts.Token);

                await SendMessageAsync(CreateSchemaMessage(), runCts.Token);
                await ExpectMessageAsync("schemaAck", runCts.Token);

                Task sampleLoopTask = SampleLoopAsync(runCts.Token);
                Task heartbeatLoopTask = HeartbeatLoopAsync(runCts.Token);

                try
                {
                    await ReceiveLoopAsync(runCts.Token);
                }
                finally
                {
                    runCts.Cancel();
                    await IgnoreCancellationAsync(sampleLoopTask);
                    await IgnoreCancellationAsync(heartbeatLoopTask);
                }
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception exception)
            {
                Debug.LogError($"[LY Perf] Deep monitor stopped: {exception}");
            }
            finally
            {
                CleanupConnection();
                runCts.Dispose();
            }
        }

        private async Task<DeepMonitorDiscoveryDocument> FetchDiscoveryDocumentAsync(
            CancellationToken cancellationToken
        )
        {
            HttpResponseMessage response = await SharedHttpClient.GetAsync(
                discoveryUrl,
                cancellationToken
            );

            response.EnsureSuccessStatusCode();

            string json = await response.Content.ReadAsStringAsync();
            LogProtocol("recv", json);

            DeepMonitorDiscoveryDocument document = JsonConvert.DeserializeObject<
                DeepMonitorDiscoveryDocument
            >(json);

            if (document == null)
            {
                throw new InvalidDataException("Discovery document is empty.");
            }

            if (document.Kind != "ly-perf.deep-monitor.discovery")
            {
                throw new InvalidDataException(
                    $"Unexpected discovery kind: {document.Kind}"
                );
            }

            if (document.DiscoveryVersion != 1)
            {
                throw new InvalidDataException(
                    $"Unsupported discovery version: {document.DiscoveryVersion}"
                );
            }

            if (
                document.Stream == null ||
                string.IsNullOrWhiteSpace(document.Stream.Host) ||
                document.Stream.Port <= 0 ||
                string.IsNullOrWhiteSpace(document.Stream.SessionToken)
            )
            {
                throw new InvalidDataException(
                    "Discovery document does not contain a valid stream target."
                );
            }

            return document;
        }

        private SchemaDeclareMessage CreateSchemaMessage()
        {
            return new SchemaDeclareMessage
            {
                Type = "schemaDeclare",
                SchemaRevision = schemaRevision,
                Metrics = new List<MetricDefinition>
                {
                    new MetricDefinition
                    {
                        Key = "unityFps",
                        Label = "Unity FPS",
                        Unit = "fps",
                        Color = "#d55454",
                        ValueType = "number",
                        AggregationHint = "last",
                        Description = "Frames per second sampled from Time.unscaledDeltaTime"
                    },
                    new MetricDefinition
                    {
                        Key = "frameTimeMs",
                        Label = "Frame Time",
                        Unit = "ms",
                        Color = "#1b8ef2",
                        ValueType = "number",
                        AggregationHint = "last",
                        Description = "Per-frame time in milliseconds"
                    },
                    new MetricDefinition
                    {
                        Key = "managedHeapMb",
                        Label = "Managed Heap",
                        Unit = "MB",
                        Color = "#7bd389",
                        ValueType = "number",
                        AggregationHint = "last",
                        Description = "Managed heap usage from GC.GetTotalMemory"
                    },
                    new MetricDefinition
                    {
                        Key = "activeTimelineIds",
                        Label = "Active Timelines",
                        Unit = string.Empty,
                        Color = "#ffd54f",
                        ValueType = "string-list",
                        AggregationHint = "last",
                        Description = "Example non-numeric state list rendered as a state timeline"
                    }
                },
                Charts = new List<ChartDefinition>
                {
                    new ChartDefinition
                    {
                        Id = "unity-fps",
                        Title = "Unity FPS",
                        MetricKeys = new List<string> { "unityFps" },
                        Order = 0,
                        YAxisLabel = "FPS",
                        YAxisUnit = "fps",
                        Stats = new ChartStats
                        {
                            Enabled = true,
                            Computations = new List<string>
                            {
                                "max",
                                "min",
                                "average"
                            },
                            Scope = "visible-range",
                            Surface = "reports-only"
                        }
                    },
                    new ChartDefinition
                    {
                        Id = "unity-frame-time",
                        Title = "Frame Time",
                        MetricKeys = new List<string> { "frameTimeMs" },
                        Order = 1,
                        YAxisLabel = "Frame Time",
                        YAxisUnit = "ms",
                        Stats = new ChartStats
                        {
                            Enabled = true,
                            Computations = new List<string>
                            {
                                "max",
                                "min",
                                "average"
                            },
                            Scope = "visible-range",
                            Surface = "reports-only"
                        }
                    },
                    new ChartDefinition
                    {
                        Id = "unity-managed-heap",
                        Title = "Managed Heap",
                        MetricKeys = new List<string> { "managedHeapMb" },
                        Order = 2,
                        YAxisLabel = "Heap",
                        YAxisUnit = "MB",
                        Stats = new ChartStats
                        {
                            Enabled = true,
                            Computations = new List<string>
                            {
                                "max",
                                "average"
                            },
                            Scope = "visible-range",
                            Surface = "reports-only"
                        }
                    },
                    new ChartDefinition
                    {
                        Id = "unity-active-timelines",
                        Title = "Active Timelines",
                        MetricKeys = new List<string> { "activeTimelineIds" },
                        Order = 3,
                        Stats = new ChartStats
                        {
                            Enabled = false,
                            Computations = new List<string>
                            {
                                "max",
                                "average"
                            },
                            Scope = "visible-range",
                            Surface = "reports-only"
                        }
                    }
                }
            };
        }

        private void CaptureMetricSnapshot()
        {
            double frameTimeMs = Math.Max(0.0001f, Time.unscaledDeltaTime) * 1000.0;
            double fps = 1000.0 / frameTimeMs;
            double managedHeapMb = GC.GetTotalMemory(false) / (1024.0 * 1024.0);
            List<string> activeTimelineIds = new List<string>
            {
                "timeline/main-loop"
            };

            if (Time.frameCount % 240 < 120)
            {
                activeTimelineIds.Add("timeline/burst-window");
            }

            if (Time.frameCount % 360 >= 180 && Time.frameCount % 360 < 300)
            {
                activeTimelineIds.Add("timeline/recovery-phase");
            }

            Dictionary<string, object> snapshot = new Dictionary<string, object>
            {
                ["unityFps"] = fps,
                ["frameTimeMs"] = frameTimeMs,
                ["managedHeapMb"] = managedHeapMb,
                ["activeTimelineIds"] = activeTimelineIds
            };

            lock (metricLock)
            {
                latestMetricValues = snapshot;
            }
        }

        private Dictionary<string, object> GetMetricSnapshot()
        {
            lock (metricLock)
            {
                return new Dictionary<string, object>(latestMetricValues);
            }
        }

        private async Task SampleLoopAsync(CancellationToken cancellationToken)
        {
            TimeSpan delay = TimeSpan.FromSeconds(Math.Max(0.1f, sampleIntervalSeconds));

            while (!cancellationToken.IsCancellationRequested)
            {
                Dictionary<string, object> values = GetMetricSnapshot();

                await SendMessageAsync(
                    new SampleBatchMessage
                    {
                        Type = "sampleBatch",
                        SchemaRevision = schemaRevision,
                        Samples = new List<SampleBatchItem>
                        {
                            new SampleBatchItem
                            {
                                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                                Sequence = nextSequence++,
                                Values = values
                            }
                        }
                    },
                    cancellationToken
                );

                await Task.Delay(delay, cancellationToken);
            }
        }

        private async Task HeartbeatLoopAsync(CancellationToken cancellationToken)
        {
            TimeSpan delay = TimeSpan.FromSeconds(
                Math.Max(1.0f, heartbeatIntervalSeconds)
            );

            while (!cancellationToken.IsCancellationRequested)
            {
                await Task.Delay(delay, cancellationToken);

                await SendMessageAsync(
                    new HeartbeatMessage
                    {
                        Type = "heartbeat",
                        ClientTimestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                    },
                    cancellationToken
                );
            }
        }

        private async Task ReceiveLoopAsync(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                JObject message = await ReadMessageAsync(cancellationToken);
                HandleServerMessage(message);
            }
        }

        private async Task ExpectMessageAsync(
            string expectedType,
            CancellationToken cancellationToken
        )
        {
            JObject message = await ReadMessageAsync(cancellationToken);
            string type = message.Value<string>("type") ?? string.Empty;

            if (type == "error")
            {
                throw new InvalidDataException(
                    $"Deep monitor error: {message.Value<string>("code")} - {message.Value<string>("message")}"
                );
            }

            if (!string.Equals(type, expectedType, StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    $"Expected {expectedType}, received {type}."
                );
            }

            LogProtocol("recv", message.ToString(Formatting.None));
        }

        private void HandleServerMessage(JObject message)
        {
            string type = message.Value<string>("type") ?? string.Empty;
            LogProtocol("recv", message.ToString(Formatting.None));

            switch (type)
            {
                case "sampleAck":
                case "heartbeatAck":
                    return;
                case "error":
                    throw new InvalidDataException(
                        $"Deep monitor error: {message.Value<string>("code")} - {message.Value<string>("message")}"
                    );
                default:
                    Debug.LogWarning($"[LY Perf] Unexpected server message: {message}");
                    return;
            }
        }

        private async Task<JObject> ReadMessageAsync(CancellationToken cancellationToken)
        {
            byte[] header = await ReadExactAsync(FrameHeaderSize, cancellationToken);
            int payloadLength =
                (header[0] << 24) |
                (header[1] << 16) |
                (header[2] << 8) |
                header[3];

            if (payloadLength <= 0)
            {
                throw new InvalidDataException(
                    $"Invalid frame length: {payloadLength}."
                );
            }

            byte[] payload = await ReadExactAsync(payloadLength, cancellationToken);
            string json = Encoding.UTF8.GetString(payload);

            try
            {
                return JObject.Parse(json);
            }
            catch (JsonException exception)
            {
                throw new InvalidDataException(
                    $"Invalid server JSON payload: {json}",
                    exception
                );
            }
        }

        private async Task<byte[]> ReadExactAsync(
            int length,
            CancellationToken cancellationToken
        )
        {
            if (networkStream == null)
            {
                throw new InvalidOperationException("Network stream is not ready.");
            }

            byte[] buffer = new byte[length];
            int offset = 0;

            while (offset < length)
            {
                int bytesRead = await networkStream.ReadAsync(
                    buffer,
                    offset,
                    length - offset,
                    cancellationToken
                );

                if (bytesRead <= 0)
                {
                    throw new EndOfStreamException(
                        "Deep monitor socket closed while reading a frame."
                    );
                }

                offset += bytesRead;
            }

            return buffer;
        }

        private async Task SendMessageAsync(object message, CancellationToken cancellationToken)
        {
            if (networkStream == null)
            {
                throw new InvalidOperationException("Network stream is not ready.");
            }

            string json = JsonConvert.SerializeObject(message, JsonSettings);
            LogProtocol("send", json);

            byte[] payload = Encoding.UTF8.GetBytes(json);
            byte[] header = new byte[FrameHeaderSize];
            header[0] = (byte)((payload.Length >> 24) & 0xFF);
            header[1] = (byte)((payload.Length >> 16) & 0xFF);
            header[2] = (byte)((payload.Length >> 8) & 0xFF);
            header[3] = (byte)(payload.Length & 0xFF);

            await networkStream.WriteAsync(header, 0, header.Length, cancellationToken);
            await networkStream.WriteAsync(payload, 0, payload.Length, cancellationToken);
            await networkStream.FlushAsync(cancellationToken);
        }

        private async Task IgnoreCancellationAsync(Task task)
        {
            try
            {
                await task;
            }
            catch (OperationCanceledException)
            {
            }
        }

        private void CleanupConnection()
        {
            try
            {
                networkStream?.Dispose();
            }
            catch
            {
            }

            try
            {
                tcpClient?.Close();
            }
            catch
            {
            }

            networkStream = null;
            tcpClient = null;
            nextSequence = 1;
        }

        private void LogProtocol(string direction, string payload)
        {
            if (!logProtocolTraffic)
            {
                return;
            }

            Debug.Log($"[LY Perf][{direction}] {payload}");
        }

        private sealed class DeepMonitorDiscoveryDocument
        {
            public string Kind { get; set; }

            public int DiscoveryVersion { get; set; }

            public long ServerTime { get; set; }

            public DiscoveryStream Stream { get; set; }

            public DiscoverySession Session { get; set; }
        }

        private sealed class DiscoveryStream
        {
            public string Host { get; set; }

            public int Port { get; set; }

            public string Transport { get; set; }

            public string SocketKind { get; set; }

            public int ProtocolVersion { get; set; }

            public string SessionToken { get; set; }
        }

        private sealed class DiscoverySession
        {
            public string Phase { get; set; }

            public int? ActiveSchemaRevision { get; set; }

            public long? ConnectedAt { get; set; }

            public long? NegotiatedAt { get; set; }
        }

        private sealed class HelloMessage
        {
            public string Type { get; set; }

            public int ProtocolVersion { get; set; }

            public string SessionToken { get; set; }
        }

        private sealed class SchemaDeclareMessage
        {
            public string Type { get; set; }

            public int SchemaRevision { get; set; }

            public List<MetricDefinition> Metrics { get; set; }

            public List<ChartDefinition> Charts { get; set; }
        }

        private sealed class MetricDefinition
        {
            public string Key { get; set; }

            public string Label { get; set; }

            public string Unit { get; set; }

            public string Color { get; set; }

            public string ValueType { get; set; }

            public string AggregationHint { get; set; }

            public string Description { get; set; }
        }

        private sealed class ChartDefinition
        {
            public string Id { get; set; }

            public string Title { get; set; }

            public List<string> MetricKeys { get; set; }

            public int Order { get; set; }

            public string YAxisLabel { get; set; }

            public string YAxisUnit { get; set; }

            public ChartStats Stats { get; set; }
        }

        private sealed class ChartStats
        {
            public bool Enabled { get; set; }

            public List<string> Computations { get; set; }

            public string Scope { get; set; }

            public string Surface { get; set; }
        }

        private sealed class SampleBatchMessage
        {
            public string Type { get; set; }

            public int SchemaRevision { get; set; }

            public List<SampleBatchItem> Samples { get; set; }
        }

        private sealed class SampleBatchItem
        {
            public long Timestamp { get; set; }

            public int Sequence { get; set; }

            public Dictionary<string, object> Values { get; set; }
        }

        private sealed class HeartbeatMessage
        {
            public string Type { get; set; }

            public long ClientTimestamp { get; set; }
        }
    }
}