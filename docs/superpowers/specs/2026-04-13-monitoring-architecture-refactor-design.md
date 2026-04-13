# 本地 LLM 容器监控看板重构设计文档

## 1. 文档信息

- 文档日期：2026-04-13
- 文档语言：中文
- 适用范围：当前 `kanban` 仓库的核心监控链路重构
- 当前阶段：设计确认后，等待用户审阅
- 本文目标：在不修改业务代码的前提下，给出一套可执行的全栈重构方案，覆盖采集、消息链路、协议兼容、快照缓存、agent 接入、降级治理与可观测性

## 2. 背景与现状

当前仓库是一个以 Next.js 为前端与 API 外壳、以 Node 自定义服务入口承载部分长连接能力的本地容器监控看板。仓库当前核心监控链路如下：

1. 前端首页通过 `SWR` 每 2 秒轮询 `/api/metrics`
2. `/api/metrics` 调用 `lib/systemMetrics.ts` 中的聚合函数
3. 采集逻辑通过 `os`、`docker` CLI、`nvidia-smi`、`rocm-smi`、`lsb_release` 等方式实时抓取数据
4. 返回聚合后的 `DashboardData` 给前端渲染

当前实现可以工作，但存在以下问题：

1. 数据采集与 HTTP 请求强耦合，请求到来时才触发采样
2. Docker 数据依赖命令行串行执行，容器数量增加时响应明显变慢
3. GPU、Docker、系统、配置等数据源没有统一采样调度框架
4. 现有 `socket.io` 仅用于 WebShell，没有服务于监控数据链路
5. 前后端协议只有 HTTP 轮询，没有现代实时消息模式
6. 缺少统一的消息队列、订阅组、消费者模型
7. 缺少统一快照层，历史接口兼容依赖临时缓存而不是正式架构
8. 缺少系统级健康中心，无法观察采集失败、降级次数和消息链路状态
9. 外部 agent 独立部署能力尚未纳入整体架构

## 3. 重构目标

本次重构的核心目标如下。

### 3.1 数据采集链路改造

1. 对 Docker 等具备标准 API 的数据源，优先使用标准 API 采样
2. 保留现有命令行采集链路作为 fallback，保证兼容性
3. GPU 部分不额外引入第三方 Node 库，直接保留并标准化封装 `nvidia-smi` 与 `rocm-smi`
4. 所有采样器具备统一的超时、错误统计、降级和恢复机制

### 3.2 性能与加载速度优化

1. 重点优化初次加载速度
2. 将“请求时采样”改为“后台持续采样 + 前台读取快照”
3. 首次页面加载直接返回内存快照，避免等待 Docker CLI 或 GPU CLI 完整执行
4. 通过预热 dispatcher 减少首屏冷启动时延

### 3.3 消息链路重构

1. 建立统一的全局内存消息队列
2. 引入 `topic`、`订阅组`、`消费者`、`分发器` 等概念
3. 所有 dispatcher 采样数据统一投递到消息总线
4. 所有图表和页面数据从统一消费者链路消费，不再直接依赖采样函数

### 3.4 双协议兼容

1. 前端与后端新增基于 WebSocket 的 modern 协议
2. 保留当前 HTTP 轮询 legacy 协议
3. 协议模式由 `env.ts` 的静态配置在启动时决定
4. 后端在保持历史 HTTP 接口兼容的同时，实现基于总线和快照的新协议

### 3.5 Agent 化扩展

1. 默认模式仍由服务端进程内采集本机宿主机指标
2. 架构上支持 dispatcher 独立部署为外部 agent
3. 外部 agent 采集后通过服务端上报入口写入统一消息总线
4. V1 数据模型保留 `sourceId` 和 `agentId`，但 UI 暂不做完整多主机展示

### 3.6 降级可观测性

1. 每个 dispatcher 同时保留高级实现和回退实现
2. 单次采样失败立即尝试 fallback
3. 连续失败达到阈值后进入默认降级态
4. 增加健康中心页面，展示健康状态、错误次数、降级状态和最近错误

## 4. 约束与已确认决策

本方案基于以下明确约束和已确认决策设计。

### 4.1 技术与依赖约束

1. 不引入静态依赖，不引入 `.so` 等系统级二进制绑定
2. 新增依赖必须来自 npm
3. 优先使用 TypeScript，并明确类型定义
4. 不滥用 `any`，不关闭类型相关 lint
5. 不考虑 TDD 流程

### 4.2 工程流程约束

1. 在用户确认计划可执行前，不修改业务代码
2. 开发阶段基于 `dev` 新建分支
3. 开发阶段每个步骤提交代码
4. 人工验收前不推送代码
5. 本地验证需构建通过、lint 通过、服务以 `3001` 端口运行成功
6. 不能影响当前使用 systemd 运行在 `3000` 端口的现有服务
7. 不使用 git worktree

### 4.3 已确认的架构决策

1. 总方案采用“进程内事件总线 + 快照缓存 + 双协议兼容”
2. V1 消息总线采用“进程内总线 + 外部上报接口”
3. 迁移策略按“一次性整体切换”设计，但保留历史 HTTP 兼容接口
4. modern 实时链路复用现有 `socket.io`
5. 外部 agent 采用静态 token 鉴权
6. 方案文档按“总方案 + 分子系统”组织
7. V1 数据模型支持 `sourceId/agentId`，但 UI 暂不做完整多主机视图
8. GPU 采集仅保留 `nvidia-smi` 与 `rocm-smi`，不引入额外调研库
9. 协议模式采用两层配置：`env.ts` 负责静态开关，`config.json` 负责运行参数
10. 消息总线 V1 采用“最新态优先”语义
11. 外部 agent V1 同时支持 HTTP 与 `socket.io` 上报
12. 健康中心 V1 仅做只读观测，不提供运维控制按钮

## 5. 总体架构

新架构拆分为六层。

1. 采集层 `dispatchers / samplers`
2. 消息总线层 `message bus`
3. 快照投影层 `snapshot projector`
4. 协议适配层 `legacy HTTP + modern socket.io`
5. 前端消费层 `transport store + view model`
6. 健康治理层 `health center + degradation state`

整体数据流如下：

1. 各 dispatcher 按配置周期运行采样
2. 采样结果被标准化为统一消息包 `MetricEnvelope`
3. 消息投递到全局内存总线
4. 总线按 topic 和订阅组将消息分发给快照消费者、健康消费者和 WebSocket 广播消费者
5. 快照消费者将最新数据投影为内存视图
6. legacy HTTP 接口直接读取快照
7. modern WebSocket 客户端先接收快照，再持续接收增量事件

## 6. 子系统一：采集层与 Dispatcher 设计

### 6.1 核心职责

采集层只负责三件事：

1. 采样
2. 记录健康状态
3. 向消息总线发布标准化消息

采集层不直接服务前端，也不直接拼接页面 DTO。

### 6.2 核心抽象

建议引入以下抽象：

1. `Dispatcher`
   - 负责某一类数据域的异步循环调度
2. `SamplerStrategy`
   - 负责一次采样的具体实现
   - 包含 `primary` 与 `fallback` 两种实现
3. `DispatcherState`
   - 负责记录健康、降级和运行元信息
4. `MetricEnvelope`
   - 负责统一描述采样结果与健康元数据

### 6.3 建议的 Dispatcher 划分

#### 6.3.1 `system-dispatcher`

负责：

1. CPU 使用率
2. CPU 核心数和型号
3. 内存总量、已用、空闲
4. OS 信息

#### 6.3.2 `docker-dispatcher`

负责：

1. 容器列表
2. 容器基础状态
3. 容器资源使用情况
4. 容器端口映射
5. 容器 GPU 绑定信息

#### 6.3.3 `gpu-dispatcher`

负责：

1. NVIDIA GPU 指标
2. AMD GPU 指标
3. GPU 模式、温度、显存、功耗、风扇等标准字段输出

#### 6.3.4 `model-config-dispatcher`

负责：

1. 读取并缓存 `model-config.json`
2. 监听配置刷新周期
3. 将模型映射作为快照的一部分持续发布

#### 6.3.5 `runtime-health-dispatcher`

负责：

1. 汇总队列与 dispatcher 自身的运行状态
2. 对外发布健康快照与健康事件

### 6.4 Dispatcher 执行模型

每个 dispatcher 是独立异步循环任务，支持以下配置：

1. `enabled`
2. `intervalMs`
3. `timeoutMs`
4. `degradeAfterFailures`
5. `recoverAfterSuccesses`
6. `apiProbeIntervalMs`

每轮执行流程如下：

1. 读取当前模式，默认优先 `primary`
2. 执行主采样策略
3. 若主采样失败，则在同一轮立即尝试 `fallback`
4. 若 fallback 成功，则该轮仍然发布指标消息，并额外发布降级事件
5. 若连续 `N` 次主采样失败且 fallback 成功，则 dispatcher 进入默认降级态
6. 在默认降级态中，主采样改为 fallback，同时按较低频率尝试主采样探测恢复
7. 连续 `M` 次主采样恢复成功后，切回主模式并发布恢复事件

### 6.5 Docker 采集策略

#### 6.5.1 主实现

Docker 数据源使用 Docker Engine API 作为主实现，Node 侧建议使用 `dockerode`。

主链路建议：

1. 使用 `listContainers` 获取基础容器列表
2. 使用 `inspect` 获取容器静态配置和设备映射
3. 使用 `stats({ stream: false })` 获取容器资源占用
4. 对端口、GPU 绑定、状态等字段进行标准化映射

#### 6.5.2 回退实现

保留现有 CLI 链路作为回退：

1. `docker ps`
2. `docker stats --no-stream`
3. `docker inspect`

#### 6.5.3 性能优化要点

1. `inspect` 结果设置较长 TTL 缓存
2. 容器列表与 stats 采样分离，避免每轮全量慢操作
3. 可选监听 `docker events` 触发静态缓存失效
4. HTTP 快照接口不再直接触发 Docker API 或 Docker CLI

### 6.6 GPU 采集策略

GPU 部分不引入额外第三方库，直接使用以下方案：

1. NVIDIA：`nvidia-smi`
2. AMD：`rocm-smi`

设计要求：

1. 两种 CLI 都被封装为正式采样策略，而不是散落在业务代码中的临时命令
2. 必须具备超时控制、错误分类和连续失败计数
3. 输出字段统一，例如 `id`、`name`、`utilization`、`memoryUsed`、`memoryTotal`、`temperature`、`powerDraw`、`powerLimit`、`fanSpeed`
4. 支持部分可用场景，即 NVIDIA 可用时不影响 AMD 分支，反之亦然

### 6.7 首次加载优化

采集层对首屏性能的贡献主要来自：

1. 服务启动后立即预热 dispatcher，而不是等待首个 HTTP 请求
2. CPU 使用率差值在 dispatcher 内维护，不再在请求链路中人为等待
3. Docker 与模型配置拆分为静态缓存与动态 stats 两类采样
4. 所有 HTTP 接口读快照，不在请求路径上做重采样

## 7. 子系统二：全局消息总线设计

### 7.1 设计目标

全局消息总线负责承接所有采样结果，并向不同消费侧提供统一分发能力。V1 不引入外部 MQ，而是实现一个面向监控场景的轻量内存总线。

设计目标如下：

1. 低延迟
2. 低额外开销
3. 支持 topic 和订阅组
4. 支持快照投影
5. 支持 WebSocket 广播消费
6. 支持健康统计
7. 允许丢弃旧样本，优先保障最新态

### 7.2 总线组成

建议拆分为四个部件：

1. `Ingress`
   - 接收本地 dispatcher 和外部 agent 上报消息
2. `TopicRouter`
   - 根据 topic 和匹配规则路由消息
3. `SubscriptionGroupManager`
   - 管理订阅组与消费者注册
4. `SnapshotProjector`
   - 将增量事件投影为快照

### 7.3 Topic 规划

V1 topic 建议按数据域划分：

1. `metrics.system`
2. `metrics.docker`
3. `metrics.gpu`
4. `config.model`
5. `health.dispatcher`
6. `health.queue`
7. `agent.report`
8. `system.snapshot.invalidate`

细粒度数据类型通过 `metricKey` 区分，例如：

1. `cpu.usage`
2. `memory.used`
3. `docker.container.stats`
4. `docker.container.lifecycle`
5. `gpu.device.stats`

### 7.4 统一消息模型

建议所有消息使用统一 envelope：

1. `id`
2. `topic`
3. `metricKey`
4. `sourceId`
5. `agentId`
6. `producerId`
7. `timestamp`
8. `sequence`
9. `payload`
10. `meta`

其中 `meta` 至少包含：

1. `mode`: `primary` | `fallback`
2. `latencyMs`
3. `sampleWindowMs`
4. `degraded`
5. `schemaVersion`
6. `errorCount`

### 7.5 订阅组语义

V1 中订阅组采用以下语义：

1. 组与组之间为广播关系
2. 组内消费者默认全部接收，不做竞争消费
3. 订阅组主要用于逻辑边界和统计治理，而不是任务队列式负载均衡

建议的订阅组：

1. `snapshot-core`
2. `snapshot-health`
3. `ws-broadcast`
4. `health-center`
5. `debug-recorder`

### 7.6 队列保留语义

V1 已确认采用“最新态优先”语义，因此：

1. 总线只保留短时历史
2. 允许丢弃旧样本
3. 客户端断线恢复依赖 snapshot，而不是完整历史回放
4. 总线不承担长期持久化职责

### 7.7 队列实现建议

建议：

1. 每个 topic 使用轻量 ring buffer
2. 每个订阅组维护自己的最新序号或短游标
3. 高性能分发器只负责 topic 命中、过滤和批量投递
4. 不在分发器中做重计算、深拷贝或页面 DTO 拼装

### 7.8 Snapshot Projector

Snapshot Projector 是一个特殊消费者，负责把增量事件转换为可供查询的内存视图。建议维护两类快照：

1. `coreSnapshot`
   - 对应首页与 legacy `/api/metrics`
2. `healthSnapshot`
   - 对应健康中心与运行治理信息

快照建议使用 `Map` 进行 KV 存储，由 key 组合出逻辑实体，例如：

1. `topic + sourceId + metricKey + entityId`

在此基础上再投影出稳定对外 DTO。

## 8. 子系统三：协议兼容层设计

### 8.1 配置分层

协议与运行参数采用两层配置。

#### 8.1.1 `env.ts`

负责启动级静态开关，例如：

1. `monitorProtocolMode: 'legacy' | 'modern'`
2. `enableExternalAgent: boolean`

#### 8.1.2 `config.json`

负责运行级参数，例如：

1. dispatcher 采样率
2. 超时
3. 降级阈值
4. token
5. 快照参数
6. 健康中心保留项

### 8.2 Legacy HTTP 模式

legacy 模式保持历史接口兼容，但底层改为统一快照驱动。

#### 8.2.1 `/api/metrics`

保留当前 DTO 形状，内部改为读取 `coreSnapshot`。不再在请求时执行 Docker、GPU 或系统采样。

#### 8.2.2 `/api/app-config`

继续向前端暴露非敏感配置。可增加如下只读字段：

1. `protocolMode`
2. `healthCenterEnabled`

#### 8.2.3 `/api/proxy-metrics`

短期可以保留，但从长期架构看建议逐步边缘化，因为它仍然代表前端通过服务端代理轮询容器原始指标端点，与新架构的统一总线思想不完全一致。

### 8.3 Modern WebSocket 模式

modern 模式复用现有 `server.js` 承载的 `socket.io` 能力，但监控事件必须与 WebShell 事件严格隔离。

建议监控事件域如下：

1. `monitor:init`
2. `monitor:snapshot`
3. `monitor:event`
4. `monitor:health`
5. `monitor:error`

连接流程：

1. 前端建立监控连接
2. 发送 `monitor:init`
3. 服务端返回一次 `monitor:snapshot`
4. 后续持续推送 `monitor:event` 与 `monitor:health`
5. 重连后重新同步 snapshot

### 8.4 双协议统一原则

本次双协议兼容不是两套采集逻辑，而是：

1. 一套 dispatcher 采集
2. 一套消息总线
3. 一套 snapshot 投影
4. 两个对外出口：HTTP 与 `socket.io`

### 8.5 首次加载优化策略

#### 8.5.1 legacy 模式

1. 页面请求直接返回快照
2. `metrics` 与 `app-config` 并行加载
3. 避免首屏等待 CLI

#### 8.5.2 modern 模式

1. 页面加载后立即建立 `socket.io` 连接
2. 第一帧先接收 snapshot
3. 后续只接收增量事件

## 9. 子系统四：前端消费层设计

### 9.1 目标

前端要做到“页面不感知底层协议差异”。无论底层是 legacy 还是 modern，页面最终消费的都应是统一视图模型。

### 9.2 客户端监控 Store

建议在前端增加统一监控 store，负责：

1. 接收 HTTP 快照或 WebSocket 增量
2. 维护当前监控视图状态
3. 向组件暴露稳定 selector

建议模式：

1. `legacy`：store 通过 HTTP 拉取并覆盖快照
2. `modern`：store 通过 `monitor:snapshot` 初始化，再消费 `monitor:event`

### 9.3 组件消费原则

页面组件不直接监听 `socket.io`，而是统一从 store 获取数据。这样可以避免：

1. 每个组件独立建立订阅
2. 事件处理逻辑分散
3. 协议切换时大量组件级改动

### 9.4 页面范围

本次主改造范围建议覆盖：

1. 首页监控页
2. 健康中心页

以下页面保持边界独立：

1. WebShell
2. benchmark 页面与流式日志
3. Docker inspect / restart
4. 磁盘用量页面或弹窗

## 10. 子系统五：Agent 架构设计

### 10.1 统一定位

外部 agent 不是另一套监控架构，而是 dispatcher 的独立部署形态。

统一模型为：

1. 服务端进程内 dispatcher 直接写入总线
2. 外部 agent 运行相同采样抽象，但通过上报接口把消息写回服务端总线

### 10.2 身份模型

所有上报消息保留如下身份字段：

1. `sourceId`
2. `agentId`
3. `producerId`

默认本机服务端可以约定：

1. `sourceId = local`
2. `agentId = local-main`

### 10.3 上报协议

V1 同时支持 HTTP 与 `socket.io`。

#### 10.3.1 HTTP 上报

建议接口：

1. `POST /api/agent/report`

支持：

1. 单条消息
2. 批量消息

适合低频、批量、实现简单的外部 agent。

#### 10.3.2 Socket.IO 上报

建议事件：

1. `agent:init`
2. `agent:report`
3. `agent:heartbeat`

适合持续推送和实时心跳。

### 10.4 鉴权方案

V1 统一采用静态 token：

1. HTTP 通过 header 传递
2. `socket.io` 通过 `auth` 或初始化 payload 传递
3. 服务端通过统一鉴权器校验
4. 校验失败记录到健康与审计事件中

### 10.5 UI 范围控制

尽管消息模型支持 `sourceId/agentId`，但 V1 UI 不做完整多主机视图。默认情况下：

1. 首页仍以当前宿主机视角展示
2. 健康中心可展示 agent 上报健康概览
3. 多主机聚合与筛选作为后续扩展方向

## 11. 子系统六：健康中心与降级治理设计

### 11.1 页面定位

健康中心是系统自监控页，不是业务监控页。V1 只做只读观测，不提供操作按钮。

### 11.2 展示内容

#### 11.2.1 Dispatcher 健康

展示字段建议包含：

1. dispatcher 名称
2. 当前模式 `primary` / `fallback`
3. 当前健康状态 `healthy` / `degraded` / `failed`
4. 连续主采样失败次数
5. 连续回退失败次数
6. 最近成功时间
7. 最近错误时间
8. 最近错误摘要
9. 最近采样耗时
10. 当前采样周期

#### 11.2.2 队列健康

展示字段建议包含：

1. topic 数量
2. 订阅组数量
3. 消费者数量
4. 最近分发耗时
5. ring buffer 使用率
6. 丢弃样本数
7. 最近一次分发错误

#### 11.2.3 Agent 健康

展示字段建议包含：

1. `agentId`
2. `sourceId`
3. 在线状态
4. 最近心跳时间
5. 最近上报时间
6. 最近鉴权失败记录

#### 11.2.4 降级记录

展示字段建议包含：

1. 哪个 dispatcher 发生降级
2. 降级开始时间
3. 连续失败次数
4. 当前是否处于默认降级态
5. 恢复时间

### 11.3 降级状态机

每个 dispatcher 的降级治理采用统一状态机：

1. 正常态：优先运行主策略
2. 单次失败：立即尝试 fallback
3. 连续失败达到阈值：进入默认降级态
4. 默认降级态：主执行 fallback，后台定期探测主策略恢复
5. 连续恢复成功达到阈值：切回正常态

该状态机的所有状态转移都要产生健康事件。

## 12. 配置设计

### 12.1 `env.ts`

建议负责以下启动级静态配置：

1. `MONITOR_PROTOCOL_MODE=legacy|modern`
2. `ENABLE_EXTERNAL_AGENT=true|false`

### 12.2 `config.json`

建议扩展为统一运行配置源，至少包括：

1. `dispatchers.system.intervalMs`
2. `dispatchers.system.timeoutMs`
3. `dispatchers.system.degradeAfterFailures`
4. `dispatchers.system.recoverAfterSuccesses`
5. `dispatchers.docker.intervalMs`
6. `dispatchers.docker.timeoutMs`
7. `dispatchers.gpu.intervalMs`
8. `dispatchers.gpu.timeoutMs`
9. `dispatchers.modelConfig.intervalMs`
10. `dispatchers.*.apiProbeIntervalMs`
11. `agent.reportToken`
12. `agent.allowExternalReport`
13. `snapshot.maxAgeMs`
14. `health.retentionLimit`
15. 现有业务配置，例如 `openWebUIPort`、`vllmApiKey`、`pythonPath`、`benchmarkPlotDir`

### 12.3 `model-config.json`

继续保留现有职责：

1. 维护容器名称到模型业务元数据的映射
2. 被 `model-config-dispatcher` 周期读取并投影为快照

## 13. 目录与模块拆分建议

以下为建议的模块分层，不代表最终文件名必须完全一致，但建议以此为边界。

### 13.1 服务端核心模块

1. `lib/config/`
2. `lib/dispatchers/`
3. `lib/samplers/`
4. `lib/message-bus/`
5. `lib/snapshots/`
6. `lib/health/`
7. `lib/transport/`

### 13.2 建议的子模块

1. `lib/dispatchers/systemDispatcher.ts`
2. `lib/dispatchers/dockerDispatcher.ts`
3. `lib/dispatchers/gpuDispatcher.ts`
4. `lib/dispatchers/modelConfigDispatcher.ts`
5. `lib/message-bus/bus.ts`
6. `lib/message-bus/router.ts`
7. `lib/message-bus/topics.ts`
8. `lib/snapshots/coreSnapshot.ts`
9. `lib/snapshots/healthSnapshot.ts`
10. `lib/health/dispatcherHealth.ts`
11. `lib/transport/monitorSocket.ts`
12. `lib/transport/agentIngress.ts`

### 13.3 前端建议模块

1. `lib/client-monitor/`
2. `components/health/`
3. `app/health/page.tsx`

## 14. 对现有文件的影响评估

### 14.1 重点重构文件

1. `lib/systemMetrics.ts`
   - 从单体采集聚合逻辑拆分为 dispatcher 与 sampler 体系
2. `app/api/metrics/route.ts`
   - 从“请求时采样”改为“读取快照”
3. `lib/appConfig.ts`
   - 扩展为统一配置加载器
4. `server.js`
   - 扩展为监控 `socket.io` 的承载入口，后续建议迁移为 TypeScript
5. `app/page.tsx`
   - 改为基于统一 transport store 消费数据

### 14.2 建议保留边界的文件或能力

以下能力不建议在本次核心重构中强行并入统一监控协议：

1. WebShell
2. benchmark 主流程
3. Docker inspect / restart
4. 磁盘扫描与磁盘树

这些模块可以逐步与新架构兼容，但不应该成为本次重构的主耦合点。

## 15. 性能收益预期

本方案的主要性能收益来自以下几个方面：

1. 后台预热采样，减少首屏冷启动等待
2. `/api/metrics` 由实时采样切为读内存快照
3. Docker 主链路由 CLI 切到标准 API，并对静态信息做缓存
4. CPU 差值计算从请求链路移出
5. modern 模式下首次以 snapshot 同步、后续只传增量事件

预期效果：

1. 初次加载显著快于当前请求触发型采样模式
2. 多容器场景下接口抖动和长尾时延下降
3. 前端刷新频率提升时，服务端负担不再线性增加

## 16. 风险与应对

### 16.1 架构复杂度上升

风险：

1. 新增 dispatcher、总线、快照和健康治理后，代码结构复杂度上升

应对：

1. 明确模块边界
2. 用 TypeScript 类型约束消息模型和快照 DTO
3. 保持每个模块职责单一

### 16.2 兼容性回归

风险：

1. legacy 页面与旧接口兼容过程中可能出现数据结构偏差

应对：

1. 保持 `DashboardData` 兼容 DTO
2. 由 snapshot projector 对外输出稳定模型

### 16.3 GPU 与 Docker 环境差异

风险：

1. 不同主机的 GPU/容器环境差异可能导致主策略或回退策略不可用

应对：

1. 统一错误分类与降级状态机
2. 健康中心暴露真实运行状态，避免静默失败

### 16.4 现有服务入口演进风险

风险：

1. `server.js` 当前为纯 JS，承担 WebShell 和未来监控 `socket.io` 双职责

应对：

1. 本次先在架构上接入监控事件
2. 后续实现阶段优先评估迁移为 TypeScript 入口

## 17. 实施边界

本设计文档只定义方案，不直接改业务代码。进入开发阶段后，建议实施边界如下：

1. 先完成底层配置、总线、快照和 dispatcher 框架
2. 再完成 legacy `/api/metrics` 兼容改造
3. 再完成 modern `socket.io` 监控协议
4. 再完成前端统一 store 与首页切换
5. 再完成健康中心页面
6. 最后补 agent 上报接口与外部接入能力

## 18. 结论

本方案通过“后台采样 + 全局内存总线 + 快照缓存 + 双协议适配”的方式，将当前仓库从“请求触发式监控”重构为“消息驱动式监控”。

方案满足以下核心诉求：

1. 对 Docker 采用标准 API 主链路，并保留现有命令行回退
2. GPU 部分保留 `nvidia-smi` 与 `rocm-smi` 双实现并进行标准化治理
3. 引入具备 topic、订阅组、消费者和统一分发器的内存消息总线
4. 保持历史 HTTP 接口兼容，同时新增基于 `socket.io` 的 modern 协议
5. 支持 dispatcher 独立部署为外部 agent，并统一进入消息总线
6. 引入健康中心与降级状态机，使采集异常、降级和恢复变得可见
7. 重点优化初次加载与高频刷新性能

该方案与当前仓库的演进方向一致，且能在不引入外部消息基础设施的前提下，为后续更大范围的分布式采集和多主机场景预留架构空间。
