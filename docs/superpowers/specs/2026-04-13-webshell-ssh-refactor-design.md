# WebShell SSH 重构设计文档

## 1. 文档信息

- 文档日期：2026-04-13
- 文档语言：中文
- 适用范围：当前 `kanban` 仓库中的本地 WebShell SSH 功能重构
- 当前阶段：设计确认后，等待用户审阅
- 本文目标：在保持现有 WebShell 使用门槛的前提下，为 SSH 连接补充隐藏式密码登录、结构化安全审计，以及可弹出独立标签页的终端承载方式

## 2. 背景与现状

当前 WebShell 相关实现分散在两个位置：

1. `components/WebShellModal.tsx`
2. `server.ts`

当前行为如下：

1. 用户先在前端输入 WebShell 访问密码，请求 `/api/webshell/auth` 获取短期 token
2. 验证通过后，前端进入 SSH 配置步骤，只支持输入用户名并上传私钥
3. 前端通过 `socket.io` 向服务端发送 `init` 事件，服务端使用 `ssh2` 连接 `127.0.0.1:22`
4. 服务端当前将连接事件、终端输入、终端输出直接追加写入仓库根目录下的 `webshell-audit.log`
5. WebShell 只以 dashboard 上层 modal 的方式展示，没有独立页面入口

当前实现可用，但有三个明显问题：

1. SSH 认证方式单一，只支持私钥，不支持密码登录
2. 审计过于粗放，当前会把终端输入输出直接落盘，容易记录敏感数据，且日志路径位于仓库目录，存在误提交风险
3. WebShell 只能覆盖在 dashboard 上方，无法独立为新标签页承载更大的终端空间

## 3. 重构目标

本次重构目标如下：

1. 保留现有 WebShell 入口密码校验流程
2. 保留默认私钥登录路径
3. 增加隐藏式 SSH 密码登录入口：当用户未选择私钥时，连续点击灰色 `Connect` 按钮 5 次，切换到密码登录模式
4. 增加结构化会话审计，记录连接元数据，但不记录任何敏感内容和终端内容
5. WebShell 保持 dashboard modal 默认入口，同时支持打开为独立标签页
6. modal 与独立标签页共用一套核心逻辑，避免双份状态机和双份连接逻辑

## 4. 不在范围内

以下内容不纳入本次重构：

1. 远程主机 SSH 连接能力；本次仍只连接本机 `127.0.0.1:22`
2. 活跃终端会话在 modal 与独立标签页之间的迁移或共享
3. 接入第三方公网 IP 服务获取浏览器出口 IP
4. 记录用户命令、终端输出、文件内容或其他业务载荷
5. 新增完整前端单元测试框架或端到端测试框架

## 5. 已确认约束与决策

### 5.1 交互决策

1. WebShell 默认继续在当前 dashboard 页面以内嵌 modal 方式打开
2. 用户可以显式点击按钮，将 WebShell 打开到独立标签页
3. 独立标签页与 modal 共用同一套核心界面和连接逻辑
4. 隐藏密码登录入口采用“未选择私钥时连续点击灰色 `Connect` 按钮 5 次”的方式触发
5. 触发后在当前 SSH 配置步骤内直接展开密码输入框，不弹额外确认层

### 5.2 审计决策

1. 审计仅记录会话级结构化元数据
2. 不记录 SSH 密码、私钥、token、终端输入、终端输出
3. 审计目录不得位于仓库工作区内，必须写到当前运行用户主目录下的专用子目录
4. 推荐审计路径为 `~/.local/share/kanban/webshell/ssh-audit.jsonl`
5. 审计字段包含服务端可见 IP 信息和浏览器上报环境信息

### 5.3 安全决策

1. 浏览器侧采集到的 IP 仅作为“浏览器上报值”，不作为权威来源
2. 服务端以 `socket.handshake.address` 与代理头作为更可靠来源
3. 模式切换时必须清理另一种认证方式的敏感输入，避免凭据混用
4. 如果审计目录不可创建或不可写，则拒绝建立 SSH 会话，而不是在无审计条件下继续放行

## 6. 总体方案

本次重构采用“共享内容层 + 两种承载壳 + 服务端统一认证与审计”的方案。

整体拆分为四层：

1. 共享前端内容层 `WebShellContent`
2. modal 承载层 `WebShellModal`
3. 独立页面承载层 `app/webshell/page.tsx`
4. 服务端 SSH 会话层 `server.ts` 中的 WebShell socket 事件处理

数据流如下：

1. 用户从 dashboard 打开 WebShell modal，或直接访问 `/webshell`
2. 用户输入 WebShell 访问密码，前端调用 `/api/webshell/auth` 获取短期 token
3. 用户在 SSH 配置步骤中选择私钥模式或通过隐藏入口切换到密码模式
4. 前端收集 SSH 凭据与浏览器审计元数据，通过 `socket.io` 发送统一 `init` 载荷
5. 服务端校验 token、校验认证模式、准备审计目录并先记录连接开始事件
6. 服务端使用 `ssh2` 发起本地 SSH 连接，成功后建立 shell，失败时回写错误并记录失败事件
7. 终端通信期间仅转发数据流，不记录终端内容；断开时记录会话结束事件

## 7. 前端设计

### 7.1 组件拆分

建议将当前 `components/WebShellModal.tsx` 拆分为以下结构：

1. `components/WebShellContent.tsx`
   - 负责完整流程状态机
   - 负责 WebShell 密码验证
   - 负责 SSH 配置表单
   - 负责 socket 连接与 xterm 生命周期
   - 负责采集浏览器侧审计字段

2. `components/WebShellModal.tsx`
   - 只负责 Ant Design `Modal` 容器
   - 接收 `open`、`onClose`
   - 渲染 `WebShellContent` 的 modal 版本

3. `app/webshell/page.tsx`
   - 渲染同一个 `WebShellContent`
   - 使用页面容器替代 modal 外壳
   - 提供“返回 Dashboard”或关闭当前页的轻量入口

这样可以保证 modal 与独立页只共享一套状态机和一套连接协议，避免后续功能漂移。

### 7.2 流程状态机

整体仍保持三步流程：

1. `step 0`：WebShell 入口密码验证
2. `step 1`：SSH 配置
3. `step 2`：Terminal

其中 `step 1` 扩展为两种 SSH 认证模式：

1. `privateKey`
2. `password`

默认进入 `privateKey` 模式。

### 7.3 隐藏密码登录入口

隐藏入口的行为定义如下：

1. 仅当当前模式为 `privateKey` 时生效
2. 仅当当前未加载私钥时生效
3. 用户连续点击灰色 `Connect` 按钮 5 次后，切换为 `password` 模式
4. 切换后在当前区域直接展开 `SSH Password` 输入框
5. 同时展示轻提示，例如“已切换为密码登录”

为避免误触和状态混乱，增加两个约束：

1. 连击计数仅在有限时间窗口内累计，建议 8 秒内完成 5 次，否则清零
2. 一旦用户已经加载私钥，隐藏点击计数立即失效并归零

### 7.4 Connect 按钮行为

由于原生 `disabled` 按钮无法响应点击事件，因此不能继续使用真正的 `disabled` 属性承载隐藏入口。

建议改为以下行为：

1. 当表单条件不满足时，按钮保持灰色视觉样式
2. 使用 `aria-disabled` 或自定义样式表达不可提交态，而不是原生 `disabled`
3. `onClick` 中根据当前模式与输入状态决定行为：
   - 私钥模式且 key 已准备好：发起连接
   - 私钥模式但 key 缺失：只累计隐藏点击次数，不发起连接
   - 密码模式且 password 已填写：发起连接
   - 密码模式但 password 缺失：提示必填，不发起连接

### 7.5 认证模式切换规则

建议增加显式切换规则，避免两种凭据同时驻留：

1. 从 `privateKey` 切换到 `password` 时，清空已加载的私钥内容
2. 从 `password` 切回 `privateKey` 时，清空 SSH 密码输入
3. UI 中提供一个显式轻量入口“改用私钥登录”，允许用户从隐藏模式切回默认模式
4. 任一时刻只允许前端提交一种 SSH 认证方式

### 7.6 浏览器审计元数据采集

前端在发起 `socket init` 前，收集如下字段：

1. `userAgent`
2. `language`
3. `platform`
4. `timezone`
5. `screen`
6. `browserReportedIp`

其中：

1. `userAgent` 来源于 `navigator.userAgent`
2. `language` 来源于 `navigator.language`
3. `platform` 优先取 `navigator.userAgentData?.platform`，否则回退到 `navigator.platform`
4. `timezone` 来源于 `Intl.DateTimeFormat().resolvedOptions().timeZone`
5. `screen` 记录为如 `1920x1080@2` 的简洁字符串
6. `browserReportedIp` 采用 best-effort 采集，可尝试基于 WebRTC candidate 提取；若浏览器不支持或提取失败，则保持空值

浏览器上报 IP 仅用于审计补充，不参与任何鉴权判断。

### 7.7 独立标签页行为

独立标签页通过新增路由 `/webshell` 提供。

建议的交互规则如下：

1. dashboard modal 中提供“在新标签页打开”按钮
2. 该按钮通过 `window.open('/webshell?handoff=<id>', '_blank', 'noopener,noreferrer')` 打开独立页
3. modal 和独立页都使用同一个 `WebShellContent`

状态传递规则如下：

1. 若用户尚未通过 WebShell 密码验证，则独立页从 `step 0` 开始
2. 若用户已获取到短期 token 且仍在 SSH 配置步骤，则独立页可通过一次性交接机制复用以下状态：
   - token
   - username
   - 当前认证模式
3. 独立页不得接收以下内容：
   - 私钥内容
   - SSH 密码
   - 已建立的 socket 连接
   - 已建立的 xterm 实例
4. 若用户已经在 `step 2`，则“新标签页打开”语义定义为“新标签页重新打开一个新的 WebShell 会话”，不迁移当前会话

交接机制建议如下：

1. 父页面在内存中生成一次性 `handoffId`
2. 父页面打开 `/webshell?handoff=<id>`，URL 中只出现随机交接 ID，不出现 token 原文
3. 新标签页加载后，通过同源 `BroadcastChannel` 或等价的一次性内存通道向父页面请求交接数据
4. 父页面仅回传短期 token、username 与当前认证模式
5. 交接完成后立即销毁该 `handoffId` 的内存记录，避免重复使用

该方案可以避免将 token 暴露在地址栏、浏览器历史或代理日志中。

该设计能够满足“允许单独弹出为新标签页”的需求，同时避免活跃终端跨 tab 迁移带来的复杂性和不稳定性。

## 8. 前后端协议设计

当前 `socket.emit('init', { username, privateKey, token })` 的载荷过于单薄，无法支撑多认证模式和审计字段。

建议统一为如下结构：

```ts
type SshAuthMode = 'privateKey' | 'password';

type WebShellAuditClientPayload = {
  browserReportedIp?: string;
  userAgent?: string;
  language?: string;
  platform?: string;
  timezone?: string;
  screen?: string;
};

type WebShellInitPayload = {
  token: string;
  username: string;
  authMode: SshAuthMode;
  privateKey?: string;
  password?: string;
  audit: WebShellAuditClientPayload;
};
```

服务端校验规则如下：

1. token 必须有效
2. `username` 必须非空
3. `authMode === 'privateKey'` 时，必须提供非空 `privateKey`，且不得依赖 `password`
4. `authMode === 'password'` 时，必须提供非空 `password`，且不得依赖 `privateKey`
5. 任一校验失败都返回通用错误消息，不回显敏感输入

服务端连接 `ssh2` 时按模式分别传入：

1. 私钥模式：`{ host, port, username, privateKey }`
2. 密码模式：`{ host, port, username, password }`

## 9. 服务端审计设计

### 9.1 审计存储路径

审计日志必须存储在当前运行用户主目录下，不允许写入仓库工作区。

推荐实现：

1. 使用 `os.homedir()` 解析当前用户主目录
2. 拼接审计目录 `~/.local/share/kanban/webshell/`
3. 在首次需要时递归创建目录
4. 将日志文件固定为 `ssh-audit.jsonl`

推荐最终路径：

```text
~/.local/share/kanban/webshell/ssh-audit.jsonl
```

若目录创建失败或文件不可写，则本次 SSH 会话初始化失败，并向前端返回通用错误，避免在无审计条件下放行。

### 9.2 审计格式

审计采用 JSON Lines 格式，每行一条完整事件，便于后续检索、解析与扩展。

建议事件结构如下：

```ts
type WebShellAuditEvent = {
  timestamp: string;
  event:
    | 'auth_token_rejected'
    | 'ssh_connect_started'
    | 'ssh_connect_succeeded'
    | 'ssh_shell_started'
    | 'ssh_connect_failed'
    | 'ssh_disconnected';
  sessionId: string;
  authMode?: 'privateKey' | 'password';
  sshUsername?: string;
  socketIp?: string;
  forwardedFor?: string;
  realIp?: string;
  browserReportedIp?: string;
  userAgent?: string;
  language?: string;
  platform?: string;
  timezone?: string;
  screen?: string;
  reason?: string;
};
```

### 9.3 审计字段来源

字段来源定义如下：

1. `socketIp`：`socket.handshake.address`
2. `forwardedFor`：`socket.handshake.headers['x-forwarded-for']`
3. `realIp`：`socket.handshake.headers['x-real-ip']`
4. `browserReportedIp`：前端主动上报，可为空
5. `userAgent`：优先使用前端上报值，也可保留 socket 握手头作为兜底参考
6. `language`、`platform`、`timezone`、`screen`：前端上报

### 9.4 审计记录时机

建议记录以下事件：

1. token 校验失败
2. SSH 连接开始
3. SSH 连接成功
4. shell 建立成功
5. SSH 连接失败
6. socket 主动断开、SSH stream 关闭或 SSH client 关闭

明确不记录：

1. 用户键入的命令
2. 终端输出内容
3. SSH 密码
4. 私钥内容
5. 短期 token 原文

## 10. 服务端实现调整

### 10.1 `server.ts` WebShell 事件边界

当前 `server.ts` 中 WebShell 逻辑需要从“连接 + 全量 I/O 审计”改为“连接 + 元数据审计”。

建议引入以下局部职责：

1. `resolveWebShellAuditPath()`
   - 解析主目录下的审计目录与文件路径
   - 确保目录存在且可写

2. `appendWebShellAuditEvent(event)`
   - 负责将结构化事件序列化为单行 JSON 并追加写入

3. `buildAuditContext(socket, clientAuditPayload)`
   - 汇总服务端 IP 信息与前端浏览器审计字段

4. `validateWebShellInitPayload(payload)`
   - 统一校验 token、用户名、认证模式与凭据存在性

这些职责可以先保持在 `server.ts` 内的局部函数中，不必为了本次重构强行抽离大量新模块。

### 10.2 会话标识

每次 `init` 建议生成一个服务端 `sessionId`，用于将同一会话的开始、成功、失败、断开事件串联起来。

`sessionId` 的用途：

1. 区分同一用户在短时间内多次连接尝试
2. 便于从 JSONL 中追踪单次会话生命周期
3. 不依赖 token 原文作为索引，避免敏感字段泄露

### 10.3 终端数据流

终端数据转发逻辑仍保留：

1. `socket.on('data')` 时向 SSH stream 写入
2. `stream.on('data')` 时向前端回推
3. `resize` 事件保持不变

但需要删除现有的以下审计行为：

1. `[IN] ...`
2. `[OUT] ...`

这样可以满足“敏感数据不要落盘”的约束。

## 11. 错误处理

建议明确以下错误处理规则：

1. `/api/webshell/auth` 验证失败时，仍只返回通用错误，不泄露额外信息
2. `init` token 无效时：
   - 记录 `auth_token_rejected`
   - 返回 `Unauthorized: invalid or expired token`
3. 审计目录不可写时：
   - 返回通用错误，例如 `WebShell audit unavailable`
   - 不发起 SSH 连接
4. SSH 连接失败时：
   - 记录 `ssh_connect_failed`
   - 将错误消息回推前端
5. shell 创建失败时：
   - 记录失败原因
   - 关闭 SSH client
6. 前端模式校验失败时：
   - 返回表单错误或轻提示
   - 不发送 socket `init`

## 12. 页面与入口改造

建议保留当前 dashboard 中的 `WebShellModal` 引用位置不变：

1. `app/page.tsx` 继续作为默认入口
2. modal 内增加“在新标签页打开”按钮
3. 新增 `app/webshell/page.tsx` 承载独立标签页版本

这样可以避免 dashboard 入口路径变化，同时满足用户对更大终端空间的需要。

## 13. 验证方案

由于当前仓库没有现成的 WebShell 自动化测试体系，本次以静态检查和手工冒烟验证为主。

### 13.1 代码验证

1. `eslint`
2. `next build`

### 13.2 手工冒烟验证

1. modal 中的私钥登录成功
2. 未选私钥时，连续点击灰色 `Connect` 5 次切换到密码模式
3. 密码模式登录成功
4. 密码模式登录失败时前端提示正常
5. 从密码模式切回私钥模式时，密码输入被清空
6. 已选私钥后，隐藏点击计数不再触发
7. modal 中点击“在新标签页打开”后，成功打开 `/webshell`
8. 已通过 WebShell 密码验证后，独立页可复用 token，但不会携带 SSH 密码或私钥
9. 独立页中可以正常建立新的 SSH 会话

### 13.3 审计验证

1. 成功连接、失败连接、无效 token、断开连接都能各自产生结构化事件
2. 审计文件路径位于用户主目录下，而不是仓库目录
3. 审计日志不包含 token、SSH 密码、私钥、命令文本、终端输出
4. `socketIp`、代理头、浏览器字段任一缺失时仍能正常写日志

## 14. 推荐实施顺序

建议按以下顺序实现，降低回归风险：

1. 先抽出 `WebShellContent`，让 modal 与独立页共享同一套内容层
2. 再扩展前端状态机与 socket `init` 载荷，加入密码模式和审计字段
3. 再改造 `server.ts`，支持双认证模式与结构化审计
4. 最后补独立标签页入口与手工验证

该顺序可以保证每一步都围绕单一边界收敛，降低同时改 UI、协议和审计时的排障复杂度。
