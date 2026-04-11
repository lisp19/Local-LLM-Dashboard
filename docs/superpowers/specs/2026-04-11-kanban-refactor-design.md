# Kanban Dashboard 重构设计与技术文档

## 目标
将现有的 Kanban Dashboard 重构为基于 Dispatcher-Agent-MQ 架构的现代化监控平台。核心目标包括：
1. **纯 JS 消息队列**：在 Node.js 进程内实现一个基于 `EventEmitter` 或纯 JS 库的全局发布/订阅消息队列，支持 Topic 和消费者组。
2. **标准 API 与降级**：使用标准 API（如 `dockerode`、`systeminformation`）替代命令行调用。在高级 API 失败时，降级到传统的 CLI 调用。
3. **双协议上报**：支持 HTTP 单次上报和 WebSocket 持续上报，允许外部 Agent 独立部署并投递数据。
4. **WebSocket 现代链路**：前端与后端通过 WebSocket 交互，实现实时数据推送。同时保留 HTTP 接口以兼容旧版前端。
5. **极速响应**：引入 KV Cache 存储最新指标快照，使 HTTP 请求能够 O(1) 极速返回。
6. **健康监控面板**：新增 `/health` 页面，实时展示各 Dispatcher 的运行状态、错误次数和当前采集模式（API/CLI）。

## 核心架构设计

### 1. 消息中间件 (Message Broker)
- **实现**：纯 TypeScript 编写的 `EventBus`，基于 Node.js 内置的 `events.EventEmitter`。
- **特性**：
  - 支持 Topic 路由（如 `metrics:system`, `metrics:gpu`, `metrics:docker`）。
  - 支持持久化订阅者和临时订阅者。
  - 核心接口：`publish(topic, payload)`, `subscribe(topic, handler)`.

### 2. Dispatcher 层 (数据采集)
- **BaseDispatcher**：抽象基类，定义了标准的采集循环、降级逻辑和状态上报机制。
  - `start()`: 启动定时采集循环。
  - `fetchStandardAPI()`: 抽象方法，使用高级 API 采集。
  - `fetchFallbackCLI()`: 抽象方法，使用命令行采集。
  - 错误计数与降级策略：连续 N 次 API 失败后，自动切换到 CLI 模式。
- **可配置性**：
  - 采样率（Interval）和相关业务参数必须是可配置的（通过读取配置文件或环境变量注入），不能硬编码。
- **具体实现**：
  - `SystemDispatcher` (CPU, Memory, OS): 使用 `os` 模块或 `systeminformation`。
  - `GpuDispatcher`: 使用 `systeminformation` 作为主链路，`execFile('nvidia-smi')` 作为降级。
  - `DockerDispatcher`: 使用 `dockerode` 作为主链路，`docker ps/stats` CLI 作为降级。

### 3. KV Cache 与 HTTP 兼容层
- **KVCache**：一个系统级的消费者，订阅所有 `metrics:*` Topic。
- **功能**：将收到的最新数据缓存在内存中。
- **HTTP 接口 (`/api/metrics`)**：直接从 KVCache 读取快照并返回，实现极速响应，完全兼容老版本前端。

### 4. WebSocket 现代链路与双协议
- **WebSocket Server (`server.js`)**：
  - 作为消费者组订阅 EventBus。
  - 接收前端的 `subscribe` 指令，定向推送对应 Topic 的数据。
- **外部 Agent 接入**：
  - **HTTP Endpoint (`/api/agent/report`)**：接收外部 Agent 的 POST 请求，将 Payload 转发到 EventBus。
  - **WebSocket Endpoint**：外部 Agent 可通过 WS 连接并持续推送数据，Server 将其转发到 EventBus。

### 5. 前端架构
- **数据层**：实现一个 `MetricsProvider`，根据配置决定使用 SWR 轮询 (Legacy) 还是 WebSocket 订阅 (Modern)。
- **健康监控页面 (`/health`)**：订阅 `system:health` Topic，展示所有 Dispatcher 的状态。

## 开发与操作规范 (严格遵守)

1. **代码修改前置确认**：在用户确认执行计划可行之前，**绝对不修改任何代码**。
2. **纯粹的开发角色**：工作范围仅限于编写代码和构建（Build）。**严禁**执行推送（Push）操作，**严禁** Kill 系统进程或重启服务。所有的部署、重启、环境变更操作均由用户人工执行。
3. **分支管理**：进入开发阶段后，必须首先基于 `dev` 分支创建并切换到一个新的功能分支（如 `feat/kanban-refactor`）。
4. **提交规范**：每个任务步骤完成后，必须进行 Git Commit，保证提交历史清晰。全部开发完成后交由用户统一验证。