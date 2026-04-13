# WebShell SSH Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有 WebShell 增加隐藏式 SSH 密码登录、会话级结构化审计、以及可弹出为独立标签页的共享终端界面。

**Architecture:** 前端将现有 `WebShellModal` 拆成共享的 `WebShellContent` 与薄壳 modal，并新增 `/webshell` 独立页面复用同一套状态机。服务端保留 `server.ts` 为 socket.io 入口，但把 SSH 初始化参数扩展为双认证模式，并把审计改成写入用户主目录下的 JSONL 会话事件日志。

**Tech Stack:** Next.js 15, React 18, TypeScript, Ant Design, socket.io, xterm.js, ssh2, Node.js `fs`/`os`/`crypto`

---

## 业务上下文

当前仓库是一个本地运行的 AI / 容器监控 dashboard，首页是 `app/page.tsx`。其中已经有一个 WebShell 入口，供用户在 dashboard 内直接连到本机 `127.0.0.1:22` 的 SSH 服务做运维操作。

现有 WebShell 流程如下：

1. 用户先输入 WebShell 访问密码，请求 `app/api/webshell/auth/route.ts` 获取一次性短期 token
2. `components/WebShellModal.tsx` 在第二步只允许输入 SSH 用户名并上传私钥
3. 前端通过 `socket.io` 发 `init` 事件给 `server.ts`
4. `server.ts` 使用 `ssh2` 连接本机 SSH，并且当前会把连接事件、终端输入、终端输出直接写进仓库目录下的 `webshell-audit.log`

本次改造的业务目标是：

1. 保留现有 WebShell 密码门禁
2. 保留默认的私钥登录体验
3. 增加一个隐藏式密码登录入口：未选择私钥时，连续点击灰色 `Connect` 5 次，切到密码登录模式
4. 将 WebShell 从“只能盖在 dashboard 上的 modal”升级为“双入口”：默认仍在当前页 modal 中打开，同时允许弹到独立标签页 `/webshell`
5. 移除当前把终端输入输出直接落盘的做法，改成只记录会话级结构化审计
6. 审计日志必须写入当前用户主目录下的子目录，而不是仓库目录，防止误提交到远程仓库

执行时必须始终对照以下设计文档：

1. `docs/superpowers/specs/2026-04-13-webshell-ssh-refactor-design.md`
2. 本计划 `docs/superpowers/plans/2026-04-13-webshell-ssh-refactor-plan.md`

关键现状与边界：

1. `npm run dev` 和 `npm run start` 都以 `server.ts` 为运行入口
2. token 当前由 `lib/webshell-tokens.js` 管理，特征是“一次性消费”
3. 当前仓库 `.gitignore` 只忽略了 `webshell-audit.log`，还没有通用的 `*.log` 忽略规则
4. 当前仓库没有已跟踪的 `.log` 文件，但执行前仍必须显式检查并清理，防止后续误提交新日志

---

## 涉及文件

| 文件 | 变更类型 | 内容 |
|---|---|---|
| `.gitignore` | Modify | 增加通用 `.log` 忽略规则，防止日志文件误提交 |
| `lib/webshell/types.ts` | Create | 共享的 SSH 认证模式、socket `init` 载荷、审计事件类型 |
| `lib/webshell/browserAudit.ts` | Create | 浏览器侧审计字段采集与 best-effort IP 提取 |
| `lib/webshell/handoff.ts` | Create | modal 到独立标签页的一次性交接逻辑 |
| `lib/webshell/serverAudit.ts` | Create | 服务端审计目录、事件写入、握手上下文与 payload 校验 |
| `components/WebShellContent.tsx` | Create | 共享的 WebShell 三步流程、隐藏密码模式、终端连接、打开新标签页 |
| `components/WebShellModal.tsx` | Modify | 仅保留 modal 外壳，内部改为复用 `WebShellContent` |
| `app/webshell/page.tsx` | Create | 独立标签页版本的 WebShell 页面 |
| `server.ts` | Modify | 支持密码认证、结构化审计、移除终端输入输出落盘 |

按用户要求，本计划不编排自动化测试或专门测试任务，只聚焦功能实现。

---

### Task 0: Git 与日志文件卫生

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 检查当前 git 工作区状态**

先执行：

```bash
git status --short
```

记录当前工作区状态，确认是否存在与本次任务无关的改动。不要回滚不属于本次任务的用户改动。

- [ ] **Step 2: 检查当前仓库是否有被 git 跟踪的 `.log` 文件**

执行：

```bash
git ls-files "*.log"
```

如果输出为空，说明当前没有被跟踪的 `.log` 文件，继续下一步。

如果输出非空，对每个结果执行：

```bash
git rm --cached "<tracked-log-file>"
```

例如如果输出里有 `webshell-audit.log`，则执行：

```bash
git rm --cached "webshell-audit.log"
```

这一步只删除 git 跟踪，不删除磁盘上的实际文件。

- [ ] **Step 3: 更新 `.gitignore`，增加通用日志忽略规则**

将当前 `.gitignore` 中：

```gitignore
# webshell audit logs
webshell-audit.log
```

替换为：

```gitignore
# runtime logs
*.log
```

保留已有的 `npm-debug.log*`、`yarn-debug.log*`、`yarn-error.log*` 等规则，不要删除。

这样可以同时忽略：

1. 旧版仓库根目录中的 `webshell-audit.log`
2. 未来可能在调试时产生的其他 `.log` 文件
3. 任何误落到仓库工作区中的运行日志

- [ ] **Step 4: 再次检查 git 状态，确认日志文件不会被提交**

执行：

```bash
git status --short
git ls-files "*.log"
```

预期结果：

1. `.gitignore` 出现在改动列表中
2. `git ls-files "*.log"` 没有输出
3. 工作区里不存在待提交的 `.log` 文件条目

- [ ] **Step 5: 提交日志卫生调整**

```bash
git add .gitignore
git commit -m "chore: ignore runtime log files"
```

如果 Step 2 执行过 `git rm --cached`，则一并提交那些跟踪移除。

---

### Task 1: 建立共享类型与前端辅助模块

**Files:**
- Create: `lib/webshell/types.ts`
- Create: `lib/webshell/browserAudit.ts`
- Create: `lib/webshell/handoff.ts`

- [ ] **Step 1: 创建共享类型文件 `lib/webshell/types.ts`**

```ts
export type SshAuthMode = 'privateKey' | 'password';

export interface WebShellAuditClientPayload {
  browserReportedIp?: string;
  userAgent?: string;
  language?: string;
  platform?: string;
  timezone?: string;
  screen?: string;
}

export interface WebShellInitPayload {
  token: string;
  username: string;
  authMode: SshAuthMode;
  privateKey?: string;
  password?: string;
  audit: WebShellAuditClientPayload;
}

export interface WebShellHandoffPayload {
  token: string;
  username: string;
  authMode: SshAuthMode;
}

export type WebShellAuditEventName =
  | 'auth_token_rejected'
  | 'ssh_connect_started'
  | 'ssh_connect_succeeded'
  | 'ssh_shell_started'
  | 'ssh_connect_failed'
  | 'ssh_disconnected';

export interface WebShellAuditEvent {
  timestamp: string;
  event: WebShellAuditEventName;
  sessionId: string;
  authMode?: SshAuthMode;
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
}
```

- [ ] **Step 2: 创建浏览器审计辅助文件 `lib/webshell/browserAudit.ts`**

```ts
import type { WebShellAuditClientPayload } from './types';

type NavigatorWithUAData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

async function resolveBrowserReportedIp(): Promise<string | undefined> {
  if (typeof window === 'undefined' || !('RTCPeerConnection' in window)) {
    return undefined;
  }

  return new Promise((resolve) => {
    const RTCPeerConnectionCtor = window.RTCPeerConnection;
    const connection = new RTCPeerConnectionCtor({ iceServers: [] });
    const timeout = window.setTimeout(() => {
      connection.close();
      resolve(undefined);
    }, 1500);

    connection.createDataChannel('webshell-audit');

    connection.onicecandidate = (event) => {
      const candidate = event.candidate?.candidate;
      if (!candidate) {
        return;
      }

      const match = candidate.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
      if (match?.[1]) {
        window.clearTimeout(timeout);
        connection.close();
        resolve(match[1]);
      }
    };

    connection
      .createOffer()
      .then((offer) => connection.setLocalDescription(offer))
      .catch(() => {
        window.clearTimeout(timeout);
        connection.close();
        resolve(undefined);
      });
  });
}

export async function collectBrowserAuditPayload(): Promise<WebShellAuditClientPayload> {
  if (typeof window === 'undefined') {
    return {};
  }

  const navigatorWithUAData = navigator as NavigatorWithUAData;
  const browserReportedIp = await resolveBrowserReportedIp();

  return {
    browserReportedIp,
    userAgent: navigator.userAgent || undefined,
    language: navigator.language || undefined,
    platform: navigatorWithUAData.userAgentData?.platform || navigator.platform || undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`,
  };
}
```

- [ ] **Step 3: 创建独立标签页交接模块 `lib/webshell/handoff.ts`**

```ts
import type { WebShellHandoffPayload } from './types';

const HANDOFF_CHANNEL_NAME = 'kanban-webshell-handoff';
const pendingHandoffs = new Map<string, WebShellHandoffPayload>();

type HandoffRequestMessage = {
  type: 'request';
  handoffId: string;
};

type HandoffResponseMessage = {
  type: 'response';
  handoffId: string;
  payload?: WebShellHandoffPayload;
};

export function createWebShellHandoff(payload: WebShellHandoffPayload): string {
  const handoffId = crypto.randomUUID();
  pendingHandoffs.set(handoffId, payload);
  return handoffId;
}

export function listenForWebShellHandoffRequests(): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return () => undefined;
  }

  const channel = new BroadcastChannel(HANDOFF_CHANNEL_NAME);

  channel.onmessage = (event: MessageEvent<HandoffRequestMessage>) => {
    if (event.data?.type !== 'request') {
      return;
    }

    const payload = pendingHandoffs.get(event.data.handoffId);
    if (!payload) {
      return;
    }

    pendingHandoffs.delete(event.data.handoffId);
    channel.postMessage({
      type: 'response',
      handoffId: event.data.handoffId,
      payload,
    } satisfies HandoffResponseMessage);
  };

  return () => channel.close();
}

export function requestWebShellHandoff(handoffId: string, timeoutMs = 1500): Promise<WebShellHandoffPayload | null> {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const channel = new BroadcastChannel(HANDOFF_CHANNEL_NAME);
    const timeout = window.setTimeout(() => {
      channel.close();
      resolve(null);
    }, timeoutMs);

    channel.onmessage = (event: MessageEvent<HandoffResponseMessage>) => {
      if (event.data?.type !== 'response' || event.data.handoffId !== handoffId) {
        return;
      }

      window.clearTimeout(timeout);
      channel.close();
      resolve(event.data.payload ?? null);
    };

    channel.postMessage({
      type: 'request',
      handoffId,
    } satisfies HandoffRequestMessage);
  });
}
```

- [ ] **Step 4: 提交共享前端基础模块**

```bash
git add lib/webshell/types.ts lib/webshell/browserAudit.ts lib/webshell/handoff.ts
git commit -m "feat: add webshell shared client helpers"
```

---

### Task 2: 提取共享 WebShell 内容层并加入隐藏密码登录

**Files:**
- Create: `components/WebShellContent.tsx`

- [ ] **Step 1: 新建共享内容组件 `components/WebShellContent.tsx`**

```tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Upload, message, Steps, Typography } from 'antd';
import { LockOutlined, UploadOutlined, UserOutlined } from '@ant-design/icons';
import { io, Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { collectBrowserAuditPayload } from '../lib/webshell/browserAudit';
import { createWebShellHandoff, listenForWebShellHandoffRequests, requestWebShellHandoff } from '../lib/webshell/handoff';
import type { SshAuthMode, WebShellInitPayload } from '../lib/webshell/types';

const { Text } = Typography;
const HIDDEN_CLICK_WINDOW_MS = 8000;

interface WebShellContentProps {
  mode: 'modal' | 'page';
  initialHandoffId?: string | null;
}

export default function WebShellContent({ mode, initialHandoffId }: WebShellContentProps) {
  const [step, setStep] = useState(0);
  const [webshellPassword, setWebshellPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [username, setUsername] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [authMode, setAuthMode] = useState<SshAuthMode>('privateKey');
  const [privateKeyStr, setPrivateKeyStr] = useState('');
  const [sshPassword, setSshPassword] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const hiddenClickTimesRef = useRef<number[]>([]);

  useEffect(() => listenForWebShellHandoffRequests(), []);

  useEffect(() => {
    if (!initialHandoffId) {
      return;
    }

    let cancelled = false;
    requestWebShellHandoff(initialHandoffId).then((handoff) => {
      if (!handoff || cancelled) {
        return;
      }

      setAuthToken(handoff.token);
      setUsername(handoff.username);
      setAuthMode(handoff.authMode);
      setStep(1);
    });

    return () => {
      cancelled = true;
    };
  }, [initialHandoffId]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      resizeCleanupRef.current?.();
      termInstance.current?.dispose();
      fitAddonRef.current = null;
    };
  }, []);

  const canConnect = useMemo(() => {
    if (!username) {
      return false;
    }

    if (authMode === 'privateKey') {
      return Boolean(privateKeyStr);
    }

    return Boolean(sshPassword);
  }, [authMode, privateKeyStr, sshPassword, username]);

  const verifyPassword = async () => {
    if (!webshellPassword) {
      message.error('Password is required');
      return;
    }

    setIsVerifying(true);
    try {
      const res = await fetch('/api/webshell/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: webshellPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        message.error('Invalid password');
        return;
      }

      setAuthToken(data.token);
      setStep(1);
    } catch {
      message.error('Verification failed');
    } finally {
      setIsVerifying(false);
    }
  };

  const switchToPasswordMode = () => {
    setPrivateKeyStr('');
    setAuthMode('password');
    hiddenClickTimesRef.current = [];
    message.info('已切换为密码登录');
  };

  const switchToPrivateKeyMode = () => {
    setSshPassword('');
    setAuthMode('privateKey');
    hiddenClickTimesRef.current = [];
  };

  const recordHiddenClick = () => {
    const now = Date.now();
    hiddenClickTimesRef.current = hiddenClickTimesRef.current
      .filter((time) => now - time <= HIDDEN_CLICK_WINDOW_MS)
      .concat(now);

    if (hiddenClickTimesRef.current.length >= 5) {
      switchToPasswordMode();
    }
  };

  const handleConnect = () => {
    if (!username) {
      message.error('Username is required');
      return;
    }

    if (authMode === 'privateKey') {
      if (!privateKeyStr) {
        recordHiddenClick();
        return;
      }
    }

    if (authMode === 'password' && !sshPassword) {
      message.error('SSH password is required');
      return;
    }

    setStep(2);
    setIsConnecting(true);
  };

  const openInNewTab = () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!authToken || step === 0 || step === 2) {
      window.open('/webshell', '_blank', 'noopener,noreferrer');
      return;
    }

    const handoffId = createWebShellHandoff({
      token: authToken,
      username,
      authMode,
    });

    window.open(`/webshell?handoff=${encodeURIComponent(handoffId)}`, '_blank', 'noopener,noreferrer');
  };

  const handleKeyUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      setPrivateKeyStr((event.target?.result as string) || '');
      hiddenClickTimesRef.current = [];
    };
    reader.readAsText(file);
    return false;
  };

  useEffect(() => {
    if (step !== 2 || !terminalRef.current) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      theme: { background: '#1e1e1e' },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    termInstance.current = term;
    fitAddonRef.current = fitAddon;

    const socket = io();
    socketRef.current = socket;

    socket.on('connect', async () => {
      const audit = await collectBrowserAuditPayload();
      const payload: WebShellInitPayload = {
        token: authToken,
        username,
        authMode,
        privateKey: authMode === 'privateKey' ? privateKeyStr : undefined,
        password: authMode === 'password' ? sshPassword : undefined,
        audit,
      };

      socket.emit('init', payload);
    });

    socket.on('ready', () => {
      setIsConnecting(false);
      term.focus();
    });

    socket.on('data', (data: string) => {
      term.write(data);
    });

    socket.on('error', (err: string) => {
      term.write(`\r\n\x1b[31m${err}\x1b[0m\r\n`);
      setIsConnecting(false);
    });

    socket.on('close', () => {
      term.write('\r\n\x1b[33mConnection closed.\x1b[0m\r\n');
    });

    term.onData((data) => {
      socket.emit('data', data);
    });

    const handleResize = () => {
      fitAddon.fit();
      socket.emit('resize', { cols: term.cols, rows: term.rows });
    };

    window.addEventListener('resize', handleResize);
    resizeCleanupRef.current = () => window.removeEventListener('resize', handleResize);

    return () => {
      socket.disconnect();
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
      term.dispose();
    };
  }, [authMode, authToken, privateKeyStr, sshPassword, step, username]);

  return (
    <div className={mode === 'page' ? 'mx-auto max-w-5xl p-6' : ''}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Text strong className="block">Local WebShell (SSH)</Text>
          <Text type="secondary" className="text-xs">
            {mode === 'page' ? '独立标签页终端' : '可在当前页面使用，也可弹出到新标签页'}
          </Text>
        </div>
        <Button onClick={openInNewTab}>
          {step === 2 ? '在新标签页重新打开' : '在新标签页打开'}
        </Button>
      </div>

      <div className="mb-4">
        <Steps
          current={step}
          size="small"
          items={[{ title: 'Auth' }, { title: 'Config' }, { title: 'Terminal' }]}
        />
      </div>

      {step === 0 && (
        <div className="space-y-4 py-4">
          <Text type="secondary">Enter the WebShell password to continue.</Text>
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="Password"
            value={webshellPassword}
            onChange={(event) => setWebshellPassword(event.target.value)}
            onPressEnter={verifyPassword}
          />
          <Button type="primary" block loading={isVerifying} onClick={verifyPassword}>
            Verify
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4 py-4">
          <div>
            <Text strong>SSH Username</Text>
            <Input
              prefix={<UserOutlined />}
              placeholder="e.g., root, ubuntu"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1"
            />
          </div>

          {authMode === 'privateKey' && (
            <div>
              <Text strong>Private Key (Client Side)</Text>
              <p className="mb-2 text-xs text-slate-500">
                Please select your private key (e.g., <code>~/.ssh/id_rsa</code> or <code>~/.ssh/id_ed25519</code>).
                The key is only kept in memory and never saved to disk.
              </p>
              <Upload beforeUpload={handleKeyUpload} maxCount={1} showUploadList={{ showRemoveIcon: true }}>
                <Button icon={<UploadOutlined />}>Select Private Key</Button>
              </Upload>
              {privateKeyStr && (
                <Text type="success" className="mt-2 block text-xs">
                  ✓ Key loaded into memory
                </Text>
              )}
            </div>
          )}

          {authMode === 'password' && (
            <div>
              <Text strong>SSH Password</Text>
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="SSH password"
                value={sshPassword}
                onChange={(event) => setSshPassword(event.target.value)}
                className="mt-1"
              />
              <Button type="link" className="px-0" onClick={switchToPrivateKeyMode}>
                改用私钥登录
              </Button>
            </div>
          )}

          <Button
            type="primary"
            block
            onClick={handleConnect}
            aria-disabled={!canConnect}
            className={!canConnect ? 'opacity-60' : ''}
          >
            Connect
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="rounded-lg bg-black p-2" style={{ height: mode === 'page' ? 'calc(100vh - 220px)' : '500px' }}>
          {isConnecting && <div className="mb-2 text-xs text-white">Connecting to localhost...</div>}
          <div ref={terminalRef} style={{ width: '100%', height: isConnecting ? 'calc(100% - 24px)' : '100%' }} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 提交共享内容层**

```bash
git add components/WebShellContent.tsx
git commit -m "feat: add shared webshell content flow"
```

---

### Task 3: 保留 modal 入口并新增独立标签页页面

**Files:**
- Modify: `components/WebShellModal.tsx`
- Create: `app/webshell/page.tsx`

- [ ] **Step 1: 将 `components/WebShellModal.tsx` 改成薄壳 modal**

```tsx
'use client';

import { Modal } from 'antd';
import WebShellContent from './WebShellContent';

interface WebShellModalProps {
  open: boolean;
  onClose: () => void;
}

export default function WebShellModal({ open, onClose }: WebShellModalProps) {
  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      width={960}
      destroyOnClose
    >
      <WebShellContent mode="modal" />
    </Modal>
  );
}
```

- [ ] **Step 2: 新建独立标签页页面 `app/webshell/page.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { Button } from 'antd';
import { useSearchParams } from 'next/navigation';
import WebShellContent from '../../components/WebShellContent';

export default function WebShellPage() {
  const searchParams = useSearchParams();
  const handoffId = searchParams.get('handoff');

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto mb-4 flex max-w-5xl items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">WebShell</h1>
          <p className="text-sm text-slate-400">独立标签页终端视图</p>
        </div>
        <Button>
          <Link href="/">返回 Dashboard</Link>
        </Button>
      </div>

      <div className="mx-auto max-w-5xl rounded-2xl border border-slate-800 bg-slate-900/80 shadow-2xl">
        <WebShellContent mode="page" initialHandoffId={handoffId} />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: 提交双入口承载层**

```bash
git add components/WebShellModal.tsx app/webshell/page.tsx
git commit -m "feat: add standalone webshell page"
```

---

### Task 4: 增加服务端审计辅助模块

**Files:**
- Create: `lib/webshell/serverAudit.ts`

- [ ] **Step 1: 新建服务端审计与 payload 校验模块 `lib/webshell/serverAudit.ts`**

```ts
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Socket } from 'socket.io';
import type { SshAuthMode, WebShellAuditClientPayload, WebShellAuditEvent, WebShellInitPayload } from './types';

const WEBSHELL_AUDIT_DIR = path.join(os.homedir(), '.local', 'share', 'kanban', 'webshell');
const WEBSHELL_AUDIT_FILE = path.join(WEBSHELL_AUDIT_DIR, 'ssh-audit.jsonl');

export interface ValidatedWebShellInitPayload {
  token: string;
  username: string;
  authMode: SshAuthMode;
  privateKey?: string;
  password?: string;
  audit: WebShellAuditClientPayload;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function ensureWebShellAuditWritable(): string {
  fs.mkdirSync(WEBSHELL_AUDIT_DIR, { recursive: true });
  fs.accessSync(WEBSHELL_AUDIT_DIR, fs.constants.W_OK);

  if (!fs.existsSync(WEBSHELL_AUDIT_FILE)) {
    fs.appendFileSync(WEBSHELL_AUDIT_FILE, '');
  }

  fs.accessSync(WEBSHELL_AUDIT_FILE, fs.constants.W_OK);
  return WEBSHELL_AUDIT_FILE;
}

export function appendWebShellAuditEvent(event: WebShellAuditEvent) {
  const filePath = ensureWebShellAuditWritable();
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`);
}

export function createWebShellSessionId(): string {
  return randomUUID();
}

export function buildAuditContext(socket: Socket, audit: WebShellAuditClientPayload) {
  const forwardedForHeader = socket.handshake.headers['x-forwarded-for'];
  const realIpHeader = socket.handshake.headers['x-real-ip'];

  return {
    socketIp: socket.handshake.address,
    forwardedFor: Array.isArray(forwardedForHeader) ? forwardedForHeader.join(', ') : forwardedForHeader,
    realIp: Array.isArray(realIpHeader) ? realIpHeader.join(', ') : realIpHeader,
    ...audit,
  };
}

export function validateWebShellInitPayload(payload: unknown): ValidatedWebShellInitPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload as Partial<WebShellInitPayload>;
  if (!isNonEmptyString(data.token) || !isNonEmptyString(data.username)) {
    return null;
  }

  if (data.authMode === 'privateKey') {
    if (!isNonEmptyString(data.privateKey) || isNonEmptyString(data.password)) {
      return null;
    }

    return {
      token: data.token,
      username: data.username,
      authMode: 'privateKey',
      privateKey: data.privateKey,
      audit: data.audit ?? {},
    };
  }

  if (data.authMode === 'password') {
    if (!isNonEmptyString(data.password) || isNonEmptyString(data.privateKey)) {
      return null;
    }

    return {
      token: data.token,
      username: data.username,
      authMode: 'password',
      password: data.password,
      audit: data.audit ?? {},
    };
  }

  return null;
}
```

- [ ] **Step 2: 提交服务端审计辅助模块**

```bash
git add lib/webshell/serverAudit.ts
git commit -m "feat: add webshell server audit helpers"
```

---

### Task 5: 改造 `server.ts` 支持密码登录与结构化审计

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: 更新 `server.ts` 的 import 区**

将文件顶部 import 区替换为以下内容：

```ts
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { Client } from 'ssh2';
import { consumeToken } from './lib/webshell-tokens';
import { ensureMonitoringRuntimeStarted } from './lib/monitoring/runtime';
import { assertAgentToken } from './lib/monitoring/transport/agentAuth';
import { SUBSCRIPTION_GROUPS, MONITOR_TOPICS } from './lib/monitoring/topics';
import type { MetricEnvelope } from './lib/monitoring/contracts';
import type { SshAuthMode } from './lib/webshell/types';
import {
  appendWebShellAuditEvent,
  buildAuditContext,
  createWebShellSessionId,
  ensureWebShellAuditWritable,
  validateWebShellInitPayload,
} from './lib/webshell/serverAudit';
```

- [ ] **Step 2: 用新的 WebShell 处理逻辑替换 `io.on('connection')` 中现有的 SSH 块**

将当前 `io.on('connection', (socket) => {` 内从 `let sshClient: Client | null = null;` 开始，到 `socket.on('disconnect', ...)` 结束的 WebShell 逻辑整体替换为：

```ts
  io.on('connection', (socket) => {
    let sshClient: Client | null = null;
    let sshStream: {
      write(data: string): void;
      setWindow(rows: number, cols: number, height: number, width: number): void;
    } | null = null;
    let sessionId: string | null = null;
    let authMode: SshAuthMode | null = null;
    let sshUsername = '';
    let auditContext: ReturnType<typeof buildAuditContext> | null = null;

    const writeAudit = (event: 'auth_token_rejected' | 'ssh_connect_started' | 'ssh_connect_succeeded' | 'ssh_shell_started' | 'ssh_connect_failed' | 'ssh_disconnected', reason?: string) => {
      if (!sessionId) {
        sessionId = createWebShellSessionId();
      }

      appendWebShellAuditEvent({
        timestamp: new Date().toISOString(),
        event,
        sessionId,
        authMode: authMode ?? undefined,
        sshUsername: sshUsername || undefined,
        reason,
        ...(auditContext ?? {}),
      });
    };

    socket.on('init', (payload: unknown) => {
      try {
        ensureWebShellAuditWritable();
      } catch {
        socket.emit('error', 'WebShell audit unavailable');
        return;
      }

      const validated = validateWebShellInitPayload(payload);
      if (!validated) {
        socket.emit('error', 'Invalid SSH initialization payload');
        return;
      }

      sessionId = createWebShellSessionId();
      authMode = validated.authMode;
      sshUsername = validated.username;
      auditContext = buildAuditContext(socket, validated.audit);

      if (!consumeToken(validated.token)) {
        writeAudit('auth_token_rejected', 'invalid_or_expired_token');
        socket.emit('error', 'Unauthorized: invalid or expired token');
        return;
      }

      writeAudit('ssh_connect_started');
      sshClient = new Client();

      sshClient
        .on('ready', () => {
          writeAudit('ssh_connect_succeeded');
          socket.emit('ready');

          sshClient?.shell((err, stream) => {
            if (err) {
              writeAudit('ssh_connect_failed', `shell:${err.message}`);
              socket.emit('error', `Shell error: ${err.message}`);
              sshClient?.end();
              return;
            }

            sshStream = stream;
            writeAudit('ssh_shell_started');

            stream
              .on('close', () => {
                writeAudit('ssh_disconnected', 'stream_closed');
                sshClient?.end();
                socket.emit('close');
              })
              .on('data', (data: Buffer) => {
                socket.emit('data', data.toString('utf-8'));
              });
          });
        })
        .on('error', (err) => {
          writeAudit('ssh_connect_failed', err.message);
          socket.emit('error', `SSH Connection Error: ${err.message}`);
        })
        .connect({
          host: '127.0.0.1',
          port: 22,
          username: validated.username,
          privateKey: validated.authMode === 'privateKey' ? validated.privateKey : undefined,
          password: validated.authMode === 'password' ? validated.password : undefined,
        });
    });

    socket.on('data', (data: string) => {
      if (sshStream) {
        sshStream.write(data);
      }
    });

    socket.on('resize', ({ cols, rows }: { cols: number; rows: number }) => {
      sshStream?.setWindow(rows, cols, 0, 0);
    });

    socket.on('disconnect', (reason: string) => {
      if (sessionId) {
        writeAudit('ssh_disconnected', reason);
      }
      sshClient?.end();
    });

    // Monitoring socket events (distinct names — no collision with WebShell)
```

- [ ] **Step 3: 提交服务端 WebShell 改造**

```bash
git add server.ts
git commit -m "feat: add password auth and structured webshell audit"
```

---

### Task 6: 串联最终功能并收口前端细节

**Files:**
- Modify: `components/WebShellContent.tsx`
- Modify: `components/WebShellModal.tsx`
- Modify: `server.ts`

- [ ] **Step 1: 在 `components/WebShellContent.tsx` 中补上两处收口细节**

将 `switchToPasswordMode` 和 `switchToPrivateKeyMode` 两个函数替换为：

```tsx
  const switchToPasswordMode = () => {
    setPrivateKeyStr('');
    setSshPassword('');
    setAuthMode('password');
    hiddenClickTimesRef.current = [];
    message.info('已切换为密码登录');
  };

  const switchToPrivateKeyMode = () => {
    setPrivateKeyStr('');
    setSshPassword('');
    setAuthMode('privateKey');
    hiddenClickTimesRef.current = [];
  };
```

并将 `openInNewTab` 函数替换为：

```tsx
  const openInNewTab = () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!authToken || step === 0 || step === 2) {
      window.open('/webshell', '_blank', 'noopener,noreferrer');
      return;
    }

    const handoffId = createWebShellHandoff({
      token: authToken,
      username,
      authMode,
    });

    window.open(`/webshell?handoff=${encodeURIComponent(handoffId)}`, '_blank', 'noopener,noreferrer');
  };
```

这样可以明确保证：

1. 切模式时只保留一种凭据
2. step 2 不迁移当前会话，只打开新会话
3. token 不出现在 URL 中

- [ ] **Step 2: 将 `components/WebShellModal.tsx` 的 `width` 调整为更适合终端的固定宽度**

确认该文件保持如下版本：

```tsx
'use client';

import { Modal } from 'antd';
import WebShellContent from './WebShellContent';

interface WebShellModalProps {
  open: boolean;
  onClose: () => void;
}

export default function WebShellModal({ open, onClose }: WebShellModalProps) {
  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      width={960}
      destroyOnClose
    >
      <WebShellContent mode="modal" />
    </Modal>
  );
}
```

- [ ] **Step 3: 确认 `server.ts` 中已经完全删除旧版 I/O 审计**

确保以下旧逻辑不再存在：

```ts
logAudit(`[OUT] ${output.replace(/\r?\n/g, '\\n')}`);
logAudit(`[IN] ${data.replace(/\r?\n/g, '\\n')}`);
const auditLogPath = path.join(process.cwd(), 'webshell-audit.log');
```

最终保留的服务端审计只能来自 `appendWebShellAuditEvent(...)`，并统一写入 `~/.local/share/kanban/webshell/ssh-audit.jsonl`。

- [ ] **Step 4: 提交最终功能收口**

```bash
git add components/WebShellContent.tsx components/WebShellModal.tsx server.ts
git commit -m "feat: finish webshell ssh refactor flow"
```
