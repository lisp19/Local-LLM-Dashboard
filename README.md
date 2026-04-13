# Local Container Monitor

A high-performance, real-time dashboard for monitoring local AI inference containers (vLLM, llama.cpp, etc.) and system resources.

![Dashboard Overview](public/dashboard_overview1.png)

## 🌟 Features

### 1. Robust Hardware Monitoring
Track CPU, RAM, and GPU (NVIDIA/AMD/CPU) usage across all running containers in real-time. Automatically detects NVLink and multi-GPU setups.

### 2. Integrated Benchmark Suite
- **Concurrency Test**: Simulate high-load scenarios with parallel requests.
- **Python-Base Suite**: High-fidelity performance analysis using a dedicated Python utility.
- **Real-time Feedback**: Stream execution logs directly to the dashboard via SSE.
- **Automated Plotting**: Generates performance trend charts (TPS, Utilization, VRAM) automatically.

![Concurrency Test](public/benchmark_concurrency1.png)
![Benchmark Results](public/benchmark_results1.png)
![Performance Chart](public/benchmark.png)

### 3. Model Testing & Reasoning
- **AI Test UI**: Instant chat interface for model verification.
- **Thinking Mode**: Native support for **Reasoning Process (CoT)** from Qwen, DeepSeek, and other models.
- **Deep Performance Metrics**: Real-time tracking of **TTFT**, **Decoding Speed (tokens/s)**, and total token count.

![Reasoning Process](public/chat_reasoning1.png)

### 4. Advanced Configuration
- **Container Discovery**: Auto-maps container names to model metadata via `model-config.json`.
- **Backend Transparency**: Mode indicators show if you're using the optimized Python suite or the frontend fallback.
- **Systemd Integration**: Automated deployment as a persistent background service.

## 🚀 Quick Start

### 1. Prerequisites
- Docker & Docker Compose
- Node.js 20+
- Conda (optional, for Python benchmark suite)
- NVIDIA Drivers / ROCm (if using GPU acceleration)

### 2. Installation & Deployment
Clone the repository and run the automated deployment script:

```bash
chmod +x deploy.sh
./deploy.sh
```
The script will:
- Install dependencies
- Build the Next.js production bundle
- Install the `vllm-dashboard` systemd service
- Available at `http://localhost:3000`

## ⚙️ Configuration

The dashboard uses a priority-ordered configuration system (`~/.config/kanban/` > project dir).

### App Config (`~/.config/kanban/config.json`)
```json
{
  "openWebUIPort": 53000,
  "vllmApiKey": "vllm-test",
  "pythonPath": "/path/to/conda/env/bin/python",
  "benchmarkPlotDir": "~/.config/kanban/benchmarks"
}
```

### Model Config (`~/.config/kanban/model-config.json`)
```json
{
  "container-name": {
    "Model": "Qwen3.5-27B",
    "Served_Name": "qwen3.5-27b",
    "Backend": "vLLM",
    "Runtime": "nvidia"
  }
}
```

## 🛠 Tech Stack
- **Dashboard**: Next.js 15, Ant Design 5, Tailwind CSS
- **Benchmarking**: Python 3.11+, Matplotlib, OpenAI SDK
- **Monitoring**: Docker Stats API, Node.js OS/Child Process, message-driven dispatcher runtime

## 🔄 Monitoring Architecture

The dashboard uses a **message-driven monitoring runtime** that runs background dispatchers and exposes snapshots over HTTP or socket.io.

### Protocol Modes

Set the client-side transport with an environment variable:

| Variable | Values | Default |
|----------|--------|---------|
| `NEXT_PUBLIC_MONITOR_PROTOCOL_MODE` | `legacy` \| `modern` | `legacy` |
| `MONITOR_QUEUE_SAMPLING_INTERVAL_MS` | integer milliseconds | `10000` |
| `MONITOR_QUEUE_RING_BUFFER_SIZE` | integer slots | `64` |

- **`legacy`**: Client polls `/api/metrics` and `/api/system-health` every 2 seconds (HTTP SWR-style).
- **`modern`**: Client connects via socket.io, emitting `monitor:init` and receiving live `monitor:snapshot` / `monitor:event` pushes.
- Queue counter session aggregation samples backend cumulative values every `MONITOR_QUEUE_SAMPLING_INTERVAL_MS` and writes sampled diffs into the Health Center stream.

### Monitoring Runtime

On startup, `server.ts` initialises a singleton monitoring runtime that runs four background dispatchers:

| Dispatcher | Primary | Fallback |
|------------|---------|----------|
| System | `/proc` + `os` module | `top` / `vmstat` CLI |
| Docker | Dockerode API | `docker stats` CLI |
| GPU | `nvidia-smi` / `rocm-smi` | graceful skip |
| Model Config | `model-config.json` watch | static snapshot |

Each dispatcher publishes `MetricEnvelope` messages to an in-memory ring-buffer bus. Projectors subscribe to those messages to maintain `DashboardData` and `HealthSnapshot` objects. Ring buffer capacity is controlled by `MONITOR_QUEUE_RING_BUFFER_SIZE`.

### Health Center

Navigate to `/health` (link in dashboard header) for a read-only view of:

- Dispatcher state, mode (primary/fallback), latency, and error counts
- Message queue stats (live in-flight queue state plus Health Center session counters with hoverable backend totals)
- Connected external agents
- Recent health events (degraded / recovered / error)

### External Agent Reporting

Remote nodes can push metric events to the local runtime:

**HTTP:**
```bash
curl -X POST http://localhost:3000/api/agent/report \
  -H 'Content-Type: application/json' \
  -H 'x-agent-token: change-me' \
  -d '[{ ...MetricEnvelope }]'
```

**Socket.io:**
```js
socket.emit('agent:init', { token: 'change-me' });
socket.emit('agent:report', metricEnvelope);
```

Configure agent reporting in `config.json`:
```json
{
  "agent": {
    "allowExternalReport": true,
    "reportToken": "change-me"
  }
}
```

### Verification on Port 3001

```bash
# Legacy mode
NEXT_PUBLIC_MONITOR_PROTOCOL_MODE=legacy PORT=3001 npm run dev

# Modern mode
NEXT_PUBLIC_MONITOR_PROTOCOL_MODE=modern PORT=3001 npm run dev

# Smoke tests
curl -s http://localhost:3001/api/system-health
curl -s -X POST http://localhost:3001/api/agent/report \
  -H 'Content-Type: application/json' \
  -H 'x-agent-token: change-me' \
  -d '[]'
```

## 📝 License
MIT
