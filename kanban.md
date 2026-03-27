VLLM / Llama.cpp 极简监控看板需求与技术规格 (Systemd 部署 + 本地模型配置版)
1. 项目概述 (Project Overview)
本项目旨在开发一个极简、轻量级的本地大模型推理服务监控看板。主要针对本地宿主机运行的多个模型容器（如 vllm, llama.cpp），提供实时资源占用监控（包含 GPU、CPU、内存等）以及基于本地配置的模型元数据展示。
核心目标：
零配置/低门槛接入宿主机：直接读取本地宿主机系统命令。采用 Node.js 直接运行 + Systemd 守护进程管理，彻底解决 Docker 隔离导致的宿主机资源及同级容器信息获取困难、权限配置繁琐的问题。
业务级抽象 (双卡片设计)：不仅展示底层容器的硬件消耗（Runtime Card），还结合本地 JSON 配置映射展示模型层面的业务信息（Model Card）。
纯粹的前端架构：坚守 React 18 的客户端渲染模式，采用传统的 API 接口 + 客户端 SWR 轮询 方案。
安全与可测试：严格限制系统命令执行权限，底层解析逻辑支持脱离 Web 服务独立通过 CLI 测试验证。
2. 核心需求描述 (Core Requirements)
2.1 系统全局资源监控区 (System & GPU Metrics)
宿主机状态：整体 CPU 使用率、系统内存（Total/Used/Free）。
Nvidia GPU 状态 (nvidia-smi)：
GPU 列表及对应型号名称。
核心利用率 (GPU-Util) 和 显存使用率 (VRAM Used/Total)。
GPU 温度 (Temperature)。
2.2 容器与模型监控区 (Container & Model Metrics)
针对每个正在运行的容器，以组合卡片 (Row/Grid) 的形式拆分为两个维度的信息展示：
A. 容器运行时卡片 (Container Runtime Card)
展示系统命令抓取的实时动态运行信息。
容器名称 (Name) 和 简短 ID。
容器健康状态 (Status/Health)。
使用的镜像名称 (Image)。
绑定的端口号 (Ports)。
绑定的 GPU 资源（通过 docker inspect 获取 --gpus 相关映射）。
容器实时资源：CPU 占用率、内存占用量/占用率。
B. 模型信息卡片 (Model Card)
基于容器名称，从本地配置文件 model-config.json 中匹配并读取用户显式配置的模型信息。
配置方式：项目根目录存放 model-config.json，第一层 Key 为容器名称，Value 为一个键值对 Map。
展示形式：在前端以表格 (Table/Descriptions 组件) 的形式动态渲染该 Map（Key 为字段名，Value 为字段值）。
示例结构：
code
JSON
{
  "vllm-qwen-14b": {
    "模型名称": "Qwen 1.5 14B Chat",
    "量化方式": "AWQ 4-bit",
    "上下文长度": "32K",
    "推理框架": "vLLM 0.3.3"
  },
  "llama-cpp-mistral": {
    "模型名称": "Mistral 7B Instruct",
    "量化方式": "GGUF Q4_K_M"
  }
}
(注：若某容器未在 JSON 中配置，该卡片可显示“未配置模型信息”的占位提示。)
3. UI/UX 设计规范 (Design Specifications)
设计语言：Material 3 Expressive (M3)
强调圆角（borderRadius: 16px 或 24px）、大面积色块区分、柔和的阴影。
色彩系统：深色模式优先 (Dark Mode by default)，强调数据对比度。
组件库：Ant Design v5 + @ant-design/cssinjs
排版 (TailwindCSS 辅助)：
顶部 Navbar：Dashboard 标题、上次刷新时间、刷新状态指示器。
全局仪表盘区：系统 CPU/Memory 卡片 + 独立 GPU 状态卡片。
容器列表区：每个容器占据一个大区块（或者水平 Row）。左半部分渲染 Runtime Card（含资源微型进度条），右半部分渲染 Model Card（基于 Ant Design 的 Descriptions 组件渲染 JSON 数据）。
4. 技术架构与选型 (Technical Architecture)
4.1 基础栈 (动态版本探测)
运行环境：Node.js 22 LTS
核心框架 (Next.js + React)：
React：限制在 18.x 版本。要求是最新的且无已知漏洞的版本。
Next.js：与 React 18 兼容的最新、无漏洞版本（动态决定，严禁引入 React 19 及 Server Actions）。
状态与请求：所有 UI 交互组件顶部标记 'use client'，采用 SWR 库客户端轮询。
4.2 后端 API 与 本地文件读取 (Server-side & I/O)
API 路由 (app/api/metrics/route.ts) 需要整合三种数据源：
系统命令 (System/GPU)：os 模块获取 CPU/内存；execFile 获取 nvidia-smi。
Docker 运行时 (Docker)：execFile 调用 docker ps 和 docker stats。
本地 JSON 配置 (FS)：使用 fs.promises.readFile 读取根目录的 model-config.json，并与 docker ps 的列表通过容器名称进行 Merge，统一返回给前端。
4.3 独立的 CLI 测试接口 (Standalone CLI Tool)
必须将解析命令和读取本地 JSON 的逻辑完全解耦到 lib/ 目录下。
提供独立测试脚本：scripts/test-cli.ts。
开发者可通过 npx tsx scripts/test-cli.ts 直接打印 JSON 结果，用于验证命令解析和 model-config.json 读取逻辑，无需启动 Web 服务。
5. 安全与防御规范 (Security Implementation)
无输入执行 (Zero-Input)：/api/metrics 接口绝对不接受前端的 Query/Body 拼接命令。
防 Shell 注入：强制使用 Node.js 的 child_process.execFile，严禁使用 exec。
文件读取限制：严格限制只读取项目根目录的 model-config.json，禁止任何路径穿越漏洞。
安全限流：实现基本防抖，限制最高刷新频率（如并发拦截，最低 1 秒）。
6. 环境部署与运维 (Systemd Management)
放弃 Docker 部署，改为使用 Systemd 作为宿主机的守护进程，以获得完整的硬件和系统级 Docker 访问权限。
6.1 服务文件规范 (vllm-dashboard.service)
在项目根目录提供一个系统服务文件模板，要求不阻塞系统正常启动：
code
Ini
[Unit]
Description=VLLM/Llama.cpp Monitor Dashboard
# 确保网络启动后再运行，且不阻塞系统核心流程
After=network.target
Wants=network-online.target[Service]
# Type=simple 确保 systemd 立即将其标记为启动，不阻塞其他进程
Type=simple
# 建议由特定具备 docker 权限的用户运行，避免直接使用 root
User=your_username
WorkingDirectory=~/kanban
Environment=NODE_ENV=production
Environment=PORT=3000
# 启动 Next.js 生产环境
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
6.2 部署脚本 (deploy.sh)
提供一个一键部署脚本辅助用户：
执行 npm install 与 npm run build。
提示用户修改 model-config.json。
提示或自动将 .service 文件软连接至 /etc/systemd/system/，并执行 systemctl daemon-reload 和 systemctl enable --now vllm-dashboard。
7. 供 AI (Agent) 执行的 Vibe Coding 步骤 (Execution Steps)
⚠️ 致 AI Agent 的强制指令 ⚠️：你必须严格遵从以下 Step-by-Step 步骤进行操作。在执行 Step 1 之前，你必须首先执行 Step 0！
Step 0: 强制联网搜索依赖 (Web Search Mandatory)
Action: 调用联网搜索工具，搜索当前最新的 React 18.x 版本号、与其完全兼容且无漏洞的 Next.js 版本号，以及 swr, antd 的最新安全版本。
Goal: 确保写入 package.json 的版本相互兼容，并且 npm audit 能够零高危警告。
Step 1: 初始化项目与配置
创建 Node.js Next.js (App Router) 项目，锁定 React 18。安装依赖：antd @ant-design/icons swr tailwindcss tsx。
在根目录创建一个默认的 model-config.json 样例文件。
Step 2: 编写底层 I/O 与命令解析服务 (lib/systemMetrics.ts)
编写纯函数，安全执行 nvidia-smi 和 docker 命令。
编写读取 model-config.json 的解析函数，安全处理文件不存在或格式错误的情况。
Step 3: 创建独立的 CLI 测试脚本 (scripts/test-cli.ts)
集成 Step 2 的函数，输出格式化 JSON。在 package.json 配置 "test:cli": "tsx scripts/test-cli.ts"。
Step 4: 创建标准 API Route (app/api/metrics/route.ts)
在 GET 方法中抓取底层数据并进行对象合并 (Merge container list with model config JSON)，统一返回给前端。
Step 5: 编写前端 UI 页面 (Dual-Card Layout)
遵守 'use client'。应用 Material 3 Expressive 风格。
重点：在容器列表中，为每个容器设计水平并排的两个区域（Runtime Card 展现硬件消耗进度条，Model Card 展现表格化的本地配置模型参数）。
Step 6: 编写 Systemd 配置文件及部署说明
生成 vllm-dashboard.service 模板文件和 deploy.sh 辅助部署脚本。
