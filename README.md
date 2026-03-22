# Local Container Monitor

A high-performance, real-time dashboard for monitoring local AI inference containers (vLLM, llama.cpp, etc.) and system resources.

![Dashboard Preview](public/preview.png)

## 🌟 Features

- **Real-time Monitoring**: Track CPU, RAM, and GPU (NVIDIA/ROCM/CPU) usage across all running Docker containers.
- **AI Inference Integration**: Native support for **vLLM** and **llama.cpp** backends with auto-discovery of model configurations.
- **Benchmark & API Testing**:
  - Integrated Chat UI for instant model testing.
  - Streaming response with **Reasoning Process (CoT)** support (foldable display).
  - Real-time performance metrics: **TTFT**, **TPS (Tokens Per Second)**, and total token count.
- **Prometheus Metrics Viewer**: Stylish internal dashboard to visualize raw Prometheus metrics from inference engines.
- **Container Management**: Pin frequently used containers to the top for quick access.
- **Open WebUI Integration**: Quick-jump button to your local Open WebUI instance.
- **Dark/Glassmorphism Design**: Modern, premium UI built with Next.js, Ant Design, and Tailwind CSS.

## 🚀 Quick Start

### 1. Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for dashboard hosting)
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
- Install and start a Systemd service named `vllm-dashboard`
- Dashboard will be available at `http://localhost:3000`

## ⚙️ Configuration

The dashboard uses a priority-ordered configuration system. It looks for files in `~/.config/kanban/` first, falling back to the project directory.

### App Config (`~/.config/kanban/config.json`)
```json
{
  "openWebUIPort": 53000,
  "vllmApiKey": "vllm-test"
}
```

### Model Config (`~/.config/kanban/model-config.json`)
Map your container names to specific model metadata:
```json
{
  "your-container-name": {
    "Model": "Gemma-3-27b",
    "Backend": "vLLM",
    "Arch": "Gemma3",
    "Runtime": "NVIDIA GPU"
  }
}
```

## 🛠 Tech Stack
- **Framework**: Next.js 15 (App Router)
- **UI Components**: Ant Design 5
- **Styling**: Tailwind CSS
- **Data Fetching**: SWR (Stale-While-Revalidate)
- **Monitoring**: Docker Stats API, Node.js OS/Child Process

## 📝 License
MIT
