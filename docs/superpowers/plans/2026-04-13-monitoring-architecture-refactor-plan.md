# Monitoring Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the current local LLM container monitoring dashboard into a dispatcher-driven, snapshot-backed, dual-protocol architecture while preserving legacy HTTP compatibility, adding a modern `socket.io` monitoring channel, and enabling external agent ingestion.

**Architecture:** The implementation replaces request-time metric collection with a singleton monitoring runtime that runs background dispatchers, publishes typed events into an in-memory topic bus, projects events into fast in-memory snapshots, and exposes those snapshots through two protocol adapters: legacy HTTP and modern `socket.io`. Docker moves to Docker Engine API first with CLI fallback, GPU remains `nvidia-smi` and `rocm-smi` only, and health/degradation becomes a first-class read-only UI.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, Node.js custom server, `socket.io`, `socket.io-client`, `dockerode`, Ant Design 6, SWR, `tsx`.

---

## 0. Business Context And Constraints

This repository is a local LLM deployment and container management dashboard. It currently monitors host CPU, memory, GPU, and Docker containers, then renders that data in a Next.js UI. The main page is `app/page.tsx`, the metrics API is `app/api/metrics/route.ts`, and the current collection logic is concentrated in `lib/systemMetrics.ts`. The custom `server.js` currently exists mainly to support WebShell via `socket.io` and `ssh2`.

### Current behavior that must be preserved

1. The home page must still show host system metrics, GPU metrics, container runtime metrics, and `model-config.json` business metadata merged together.
2. `app/api/metrics/route.ts` must remain available for legacy consumers.
3. The benchmark and Docker-management flows must keep working while the monitoring core is refactored.
4. The existing service on port `3000` must not be interrupted during development.

### New behavior that must be added

1. Introduce a background dispatcher architecture.
2. Introduce a global in-memory message bus with topics and subscription groups.
3. Introduce an in-memory snapshot cache used by HTTP and WebSocket outputs.
4. Add a protocol switch driven by `env.ts`.
5. Add an external agent ingestion path over HTTP and `socket.io`.
6. Add a read-only health center page for dispatcher/queue/degradation state.

### Explicit user constraints

1. Do not modify production behavior on port `3000`; verify locally on port `3001`.
2. Do not use git worktrees.
3. Do not push code before human acceptance.
4. New dependencies must come from npm only.
5. Prefer TypeScript and explicit types.
6. Do not rely on TDD; use incremental implementation plus verification commands instead.
7. GPU collection must stay limited to `nvidia-smi` and `rocm-smi`; do not introduce other GPU libraries.

### Existing repository hotspots

1. `app/page.tsx`
   - Large client page using `SWR('/api/metrics')` and `SWR('/api/app-config')`
   - Directly imports `DashboardData` and `ContainerMetrics` from `lib/systemMetrics.ts`
2. `lib/systemMetrics.ts`
   - Current monolithic collection layer
   - Uses `os`, `docker` CLI, `nvidia-smi`, `rocm-smi`, and `loadModelConfig()`
3. `lib/appConfig.ts`
   - Current config loader, but not all routes use it
4. `server.js`
   - Current custom Next.js server with `socket.io` for WebShell only
5. `app/api/benchmark-python/route.ts`
   - Still calls `getDashboardData()` directly and reads config manually
6. `app/metrics/page.tsx`
   - Separate Prometheus detail page using `/api/proxy-metrics`
7. `components/WebShellModal.tsx`
   - Existing `socket.io-client` user; must remain isolated from new monitor events

## 1. Planned File Layout

Implement the refactor with the following file structure. Keep files focused by responsibility.

### Files to create

1. `env.ts`
   - Static startup config shared by server and client code
2. `server.ts`
   - TypeScript replacement for `server.js`
3. `lib/config/types.ts`
   - Runtime config types
4. `lib/config/loadConfig.ts`
   - Unified config/model loader and defaults
5. `lib/monitoring/contracts.ts`
   - Shared monitoring types: envelopes, snapshots, health, protocol mode
6. `lib/monitoring/topics.ts`
   - Topic and subscription-group constants
7. `lib/monitoring/bus.ts`
   - In-memory ring-buffer bus, publisher, subscription manager
8. `lib/monitoring/runtime.ts`
   - Monitoring runtime singleton bootstrap and lifecycle
9. `lib/monitoring/projectors/coreProjector.ts`
   - Projects event stream into legacy-compatible dashboard snapshot
10. `lib/monitoring/projectors/healthProjector.ts`
   - Projects health/queue/agent state
11. `lib/monitoring/samplers/systemPrimary.ts`
12. `lib/monitoring/samplers/systemFallback.ts`
13. `lib/monitoring/samplers/dockerApi.ts`
14. `lib/monitoring/samplers/dockerCli.ts`
15. `lib/monitoring/samplers/gpuPrimary.ts`
16. `lib/monitoring/samplers/gpuFallback.ts`
17. `lib/monitoring/samplers/modelConfigPrimary.ts`
18. `lib/monitoring/samplers/modelConfigFallback.ts`
19. `lib/monitoring/dispatchers/createDispatcher.ts`
20. `lib/monitoring/dispatchers/systemDispatcher.ts`
21. `lib/monitoring/dispatchers/dockerDispatcher.ts`
22. `lib/monitoring/dispatchers/gpuDispatcher.ts`
23. `lib/monitoring/dispatchers/modelConfigDispatcher.ts`
24. `lib/monitoring/transport/monitorSocket.ts`
   - `socket.io` bridge for monitor clients and agents
25. `lib/monitoring/transport/agentAuth.ts`
26. `lib/client-monitor/types.ts`
27. `lib/client-monitor/store.ts`
28. `lib/client-monitor/useMonitorTransport.ts`
29. `lib/client-monitor/socket.ts`
30. `components/health/DispatcherHealthTable.tsx`
31. `components/health/QueueHealthCard.tsx`
32. `components/health/AgentHealthTable.tsx`
33. `app/api/system-health/route.ts`
34. `app/api/agent/report/route.ts`
35. `app/health/page.tsx`

### Files to modify

1. `package.json`
   - Add `dockerode`
   - Switch scripts from `server.js` to `server.ts`
2. `config.default.json`
   - Expand with dispatcher, agent, snapshot, health defaults
3. `lib/appConfig.ts`
   - Convert to compatibility wrapper or re-export unified loader
4. `lib/systemMetrics.ts`
   - Convert to legacy DTO facade backed by snapshots instead of direct collection
5. `app/api/metrics/route.ts`
   - Read from runtime snapshot, not direct collection
6. `app/api/app-config/route.ts`
   - Expose protocol mode and allowed client config fields
7. `app/api/benchmark-python/route.ts`
   - Stop reading config manually; use unified config and snapshot access
8. `app/api/benchmark-image/route.ts`
   - Stop reading config manually
9. `app/api/disk-usage/route.ts`
   - Stop reading config manually
10. `app/page.tsx`
   - Replace direct SWR metrics coupling with protocol-aware store
11. `README.md`
   - Document protocol mode, new config keys, health page, and port-3001 verification
12. `scripts/test-cli.ts`
   - Rework around monitoring runtime/legacy snapshot

### Files to leave functionally independent for this refactor

1. `components/WebShellModal.tsx`
2. `app/api/docker/route.ts`
3. `app/api/benchmark/route.ts`
4. `app/metrics/page.tsx`

They may receive compatibility updates, but they should not be forced into the new monitoring transport in this refactor.

## 2. Runtime Contracts To Implement First

Before touching route logic or UI, lock down the shared types.

### Static protocol config in `env.ts`

```ts
export type MonitorProtocolMode = 'legacy' | 'modern';

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export const monitorEnv = {
  monitorProtocolMode: (process.env.NEXT_PUBLIC_MONITOR_PROTOCOL_MODE ?? 'legacy') as MonitorProtocolMode,
  enableExternalAgent: readBoolean(process.env.ENABLE_EXTERNAL_AGENT, true),
} as const;
```

### Shared envelope contract in `lib/monitoring/contracts.ts`

```ts
export type DispatcherMode = 'primary' | 'fallback';
export type DispatcherHealth = 'healthy' | 'degraded' | 'failed';

export interface MetricEnvelope<TPayload = unknown> {
  id: string;
  topic: string;
  metricKey: string;
  sourceId: string;
  agentId: string;
  producerId: string;
  timestamp: number;
  sequence: number;
  payload: TPayload;
  meta: {
    mode: DispatcherMode;
    latencyMs: number;
    sampleWindowMs: number;
    degraded: boolean;
    errorCount: number;
    schemaVersion: 1;
  };
}
```

### Dispatcher state contract

```ts
export interface DispatcherState {
  name: string;
  mode: DispatcherMode;
  health: DispatcherHealth;
  consecutivePrimaryFailures: number;
  consecutiveFallbackFailures: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  lastLatencyMs: number | null;
  intervalMs: number;
}
```

### Legacy dashboard DTO contract

Keep the existing UI-compatible shape alive:

```ts
export interface DashboardData {
  system: SystemMetrics;
  gpus: GpuMetrics[];
  containers: Array<{
    runtime: ContainerMetrics;
    modelConfig: Record<string, string | number | boolean> | null;
  }>;
}
```

## 3. Task Plan

### Task 1: Prepare The Branch, Server Entry, And Baseline

**Files:**
- Create: `server.ts`
- Modify: `package.json`
- Modify: `README.md`
- Delete after cutover: `server.js` or keep temporarily until `server.ts` is verified

- [ ] **Step 1: Create the feature branch from `dev`**

Run:

```bash
git checkout dev
git switch -c feat/monitoring-architecture-refactor
```

Expected: branch switches cleanly to `feat/monitoring-architecture-refactor`.

- [ ] **Step 2: Capture the baseline before changing runtime entrypoints**

Run:

```bash
git status --short
npm run lint
npm run build
```

Expected:

1. `git status --short` shows the current worktree state.
2. `npm run lint` and `npm run build` establish the starting point, even if they already pass.

- [ ] **Step 3: Convert the custom server entry from JS to TS**

Start `server.ts` from this typed structure:

```ts
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { consumeToken } from './lib/webshell-tokens';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url || '/', true);
    await handle(req, res, parsedUrl);
  });

  const io = new SocketIOServer(server);

  io.on('connection', (socket) => {
    let sshClient: Client | null = null;
    let sshStream: { write(data: string): void; setWindow(rows: number, cols: number, height: number, width: number): void } | null = null;
    const auditLogPath = path.join(process.cwd(), 'webshell-audit.log');

    const logAudit = (message: string) => {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(auditLogPath, `[${timestamp}] ${message}\n`);
    };

    socket.on('init', ({ username, privateKey, token }: { username: string; privateKey: string; token: string }) => {
      if (!consumeToken(token)) {
        logAudit('Rejected unauthorized init attempt (invalid/expired token)');
        socket.emit('error', 'Unauthorized: invalid or expired token');
        return;
      }

      logAudit(`Connection attempt for user: ${username}`);
      sshClient = new Client();

      sshClient
        .on('ready', () => {
          logAudit(`SSH connection successful for user: ${username}`);
          socket.emit('ready');

          sshClient?.shell((err, stream) => {
            if (err) {
              logAudit(`Shell error: ${err.message}`);
              socket.emit('error', `Shell error: ${err.message}`);
              return;
            }

            sshStream = stream;
            stream
              .on('close', () => {
                logAudit('SSH stream closed');
                sshClient?.end();
                socket.emit('close');
              })
              .on('data', (data: Buffer) => {
                const output = data.toString('utf-8');
                logAudit(`[OUT] ${output.replace(/\r?\n/g, '\\n')}`);
                socket.emit('data', output);
              });
          });
        })
        .on('error', (err) => {
          logAudit(`SSH connection error: ${err.message}`);
          socket.emit('error', `SSH Connection Error: ${err.message}`);
        })
        .connect({
          host: '127.0.0.1',
          port: 22,
          username,
          privateKey,
        });
    });

    socket.on('data', (data: string) => {
      if (sshStream) {
        logAudit(`[IN] ${data.replace(/\r?\n/g, '\\n')}`);
        sshStream.write(data);
      }
    });

    socket.on('resize', ({ cols, rows }: { cols: number; rows: number }) => {
      sshStream?.setWindow(rows, cols, 0, 0);
    });

    socket.on('disconnect', () => {
      logAudit('WebSocket client disconnected');
      sshClient?.end();
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
```

- [ ] **Step 4: Point package scripts at `server.ts`**

Update `package.json` scripts to this shape:

```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "next build",
    "start": "NODE_ENV=production tsx server.ts",
    "lint": "eslint",
    "test:cli": "tsx scripts/test-cli.ts"
  }
}
```

- [ ] **Step 5: Verify the TypeScript server entry works before deeper refactors**

Run:

```bash
npm run lint
PORT=3001 npm run dev
```

Expected:

1. Lint passes.
2. Dev server starts on `http://localhost:3001`.
3. Existing home page still renders.

- [ ] **Step 6: Commit the server-entry migration**

Run:

```bash
git add package.json server.ts README.md
git commit -m "refactor: migrate custom server entry to typescript"
```

### Task 2: Centralize Static Env And Runtime Config

**Files:**
- Create: `env.ts`
- Create: `lib/config/types.ts`
- Create: `lib/config/loadConfig.ts`
- Modify: `lib/appConfig.ts`
- Modify: `config.default.json`
- Modify: `app/api/app-config/route.ts`
- Modify: `app/api/benchmark-python/route.ts`
- Modify: `app/api/benchmark-image/route.ts`
- Modify: `app/api/disk-usage/route.ts`

- [ ] **Step 1: Add the startup-level static environment contract**

Create `env.ts` with this concrete shape:

```ts
export type MonitorProtocolMode = 'legacy' | 'modern';

const monitorProtocolMode = (process.env.NEXT_PUBLIC_MONITOR_PROTOCOL_MODE ?? 'legacy') as MonitorProtocolMode;
const enableExternalAgent = process.env.ENABLE_EXTERNAL_AGENT !== 'false';

export const monitorEnv = {
  monitorProtocolMode,
  enableExternalAgent,
} as const;
```

- [ ] **Step 2: Define the runtime config schema used everywhere else**

Create `lib/config/types.ts` with these minimum types:

```ts
export interface DispatcherRuntimeConfig {
  enabled: boolean;
  intervalMs: number;
  timeoutMs: number;
  degradeAfterFailures: number;
  recoverAfterSuccesses: number;
  apiProbeIntervalMs: number;
}

export interface MonitoringConfig {
  openWebUIPort: number;
  vllmApiKey: string;
  pythonPath: string;
  benchmarkPlotDir: string;
  dispatchers: {
    system: DispatcherRuntimeConfig;
    docker: DispatcherRuntimeConfig;
    gpu: DispatcherRuntimeConfig;
    modelConfig: DispatcherRuntimeConfig;
  };
  agent: {
    allowExternalReport: boolean;
    reportToken: string;
  };
  snapshot: {
    maxAgeMs: number;
  };
  health: {
    retentionLimit: number;
  };
}
```

- [ ] **Step 3: Implement a single config loader and model-config loader**

Create `lib/config/loadConfig.ts` around this shape:

```ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { MonitoringConfig } from './types';

const DEFAULT_CONFIG: MonitoringConfig = {
  openWebUIPort: 53000,
  vllmApiKey: 'vllm-test',
  pythonPath: '~/miniconda3/envs/kt/bin/python',
  benchmarkPlotDir: '~/.config/kanban/benchmarks',
  dispatchers: {
    system: { enabled: true, intervalMs: 1000, timeoutMs: 1000, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5000 },
    docker: { enabled: true, intervalMs: 1500, timeoutMs: 2000, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5000 },
    gpu: { enabled: true, intervalMs: 1500, timeoutMs: 2000, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5000 },
    modelConfig: { enabled: true, intervalMs: 5000, timeoutMs: 1000, degradeAfterFailures: 2, recoverAfterSuccesses: 1, apiProbeIntervalMs: 10000 },
  },
  agent: {
    allowExternalReport: true,
    reportToken: 'change-me',
  },
  snapshot: {
    maxAgeMs: 5000,
  },
  health: {
    retentionLimit: 200,
  },
};

function getConfigCandidateDirs(): string[] {
  return [
    path.join(os.homedir(), '.config', 'kanban'),
    process.cwd(),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDeep<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override)) {
    return (override as T) ?? base;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeDeep(current, value) : value;
  }
  return result as T;
}

export async function loadMonitoringConfig(): Promise<MonitoringConfig> {
  for (const dir of getConfigCandidateDirs()) {
    const configPath = path.join(dir, 'config.json');
    try {
      const content = await fs.readFile(configPath, 'utf8');
      return mergeDeep(DEFAULT_CONFIG, JSON.parse(content));
    } catch {
      continue;
    }
  }

  return DEFAULT_CONFIG;
}

export async function loadModelConfig(): Promise<Record<string, Record<string, string | number | boolean>>> {
  for (const dir of getConfigCandidateDirs()) {
    const configPath = path.join(dir, 'model-config.json');
    try {
      const content = await fs.readFile(configPath, 'utf8');
      return JSON.parse(content) as Record<string, Record<string, string | number | boolean>>;
    } catch {
      continue;
    }
  }

  return {};
}
```

- [ ] **Step 4: Turn `lib/appConfig.ts` into a compatibility wrapper so old imports keep working during the refactor**

Use this shape:

```ts
export { loadMonitoringConfig as loadAppConfig, loadModelConfig } from './config/loadConfig';
export type { MonitoringConfig as AppConfig } from './config/types';
```

- [ ] **Step 5: Expand `config.default.json` so a fresh engineer understands the required config shape immediately**

Use a concrete example payload:

```json
{
  "openWebUIPort": 53000,
  "vllmApiKey": "vllm-test",
  "pythonPath": "~/miniconda3/envs/kt/bin/python",
  "benchmarkPlotDir": "~/.config/kanban/benchmarks",
  "dispatchers": {
    "system": { "enabled": true, "intervalMs": 1000, "timeoutMs": 1000, "degradeAfterFailures": 3, "recoverAfterSuccesses": 2, "apiProbeIntervalMs": 5000 },
    "docker": { "enabled": true, "intervalMs": 1500, "timeoutMs": 2000, "degradeAfterFailures": 3, "recoverAfterSuccesses": 2, "apiProbeIntervalMs": 5000 },
    "gpu": { "enabled": true, "intervalMs": 1500, "timeoutMs": 2000, "degradeAfterFailures": 3, "recoverAfterSuccesses": 2, "apiProbeIntervalMs": 5000 },
    "modelConfig": { "enabled": true, "intervalMs": 5000, "timeoutMs": 1000, "degradeAfterFailures": 2, "recoverAfterSuccesses": 1, "apiProbeIntervalMs": 10000 }
  },
  "agent": {
    "allowExternalReport": true,
    "reportToken": "change-me"
  },
  "snapshot": { "maxAgeMs": 5000 },
  "health": { "retentionLimit": 200 }
}
```

- [ ] **Step 6: Update config consumers to use the unified loader**

Replace manual file reads in:

1. `app/api/benchmark-python/route.ts`
2. `app/api/benchmark-image/route.ts`
3. `app/api/disk-usage/route.ts`

with imports like:

```ts
import { loadAppConfig } from '../../../lib/appConfig';
```

and use:

```ts
const config = await loadAppConfig();
```

- [ ] **Step 7: Expose protocol mode to the client through `/api/app-config`**

Return at least:

```ts
return Response.json({
  openWebUIPort: config.openWebUIPort,
  protocolMode: monitorEnv.monitorProtocolMode,
  healthCenterEnabled: true,
});
```

- [ ] **Step 8: Verify config loading and routes**

Run:

```bash
npm run lint
npx tsx scripts/check-config-loading.ts
PORT=3001 npm run dev
curl -s http://localhost:3001/api/app-config
```

Expected:

1. Lint passes.
2. Config-loading script prints a parsed model config object or `{}`.
3. `/api/app-config` returns JSON with `protocolMode`.

- [ ] **Step 9: Commit centralized config work**

Run:

```bash
git add env.ts config.default.json lib/config lib/appConfig.ts app/api/app-config/route.ts app/api/benchmark-python/route.ts app/api/benchmark-image/route.ts app/api/disk-usage/route.ts
git commit -m "refactor: centralize monitoring configuration"
```

### Task 3: Define Monitoring Contracts, Topics, And Legacy DTO Bridge

**Files:**
- Create: `lib/monitoring/contracts.ts`
- Create: `lib/monitoring/topics.ts`
- Modify: `lib/systemMetrics.ts`
- Modify: `scripts/test-cli.ts`

- [ ] **Step 1: Move all shared monitoring and legacy DTO types into a single contract file**

Create `lib/monitoring/contracts.ts` with:

```ts
export type DispatcherMode = 'primary' | 'fallback';
export type DispatcherHealth = 'healthy' | 'degraded' | 'failed';

export interface SystemMetrics {
  cpuUsage: number;
  cpuCores: number;
  cpuModel: string;
  osRelease: string;
  memory: {
    total: number;
    used: number;
    free: number;
  };
}

export interface GpuMetrics {
  id: string;
  name: string;
  type: 'Nvidia' | 'AMD';
  utilization: string;
  memoryUsed: string;
  memoryTotal: string;
  temperature: string;
  powerDraw: string;
  powerLimit: string;
  fanSpeed: string;
}

export interface ContainerMetrics {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  cpuPercent: string;
  memUsage: string;
  memUsedRaw: number;
  gpus: string[];
}

export interface DashboardData {
  system: SystemMetrics;
  gpus: GpuMetrics[];
  containers: Array<{
    runtime: ContainerMetrics;
    modelConfig: Record<string, string | number | boolean> | null;
  }>;
}

export interface DispatcherState {
  name: string;
  mode: DispatcherMode;
  health: DispatcherHealth;
  consecutivePrimaryFailures: number;
  consecutiveFallbackFailures: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  lastLatencyMs: number | null;
  intervalMs: number;
}

export interface HealthSnapshot {
  dispatchers: DispatcherState[];
  queue: {
    topicCount: number;
    groupCount: number;
    consumerCount: number;
    droppedMessages: number;
  };
  agents: Array<{
    sourceId: string;
    agentId: string;
    lastSeenAt: number;
    transport: 'http' | 'socket.io';
  }>;
  events: Array<{
    type: 'degraded' | 'recovered' | 'error';
    dispatcher: string;
    message: string;
    timestamp: number;
  }>;
}

export interface CoreSnapshot {
  dashboard: DashboardData;
  updatedAt: number;
}
```

- [ ] **Step 2: Create a single source of truth for topic and subscription-group names**

Create `lib/monitoring/topics.ts` with:

```ts
export const MONITOR_TOPICS = {
  metricsSystem: 'metrics.system',
  metricsDocker: 'metrics.docker',
  metricsGpu: 'metrics.gpu',
  configModel: 'config.model',
  healthDispatcher: 'health.dispatcher',
  healthQueue: 'health.queue',
  agentReport: 'agent.report',
} as const;

export const SUBSCRIPTION_GROUPS = {
  snapshotCore: 'snapshot-core',
  snapshotHealth: 'snapshot-health',
  wsBroadcast: 'ws-broadcast',
  healthCenter: 'health-center',
} as const;
```

- [ ] **Step 3: Turn `lib/systemMetrics.ts` into a compatibility facade instead of a collector implementation**

Keep its public exports but reduce it to:

```ts
import type { DashboardData, SystemMetrics, GpuMetrics, ContainerMetrics } from './monitoring/contracts';
import { ensureMonitoringRuntimeStarted, getLegacyDashboardSnapshotOnce } from './monitoring/runtime';

export type { DashboardData, SystemMetrics, GpuMetrics, ContainerMetrics };

export async function getDashboardData(): Promise<DashboardData> {
  await ensureMonitoringRuntimeStarted();
  return getLegacyDashboardSnapshotOnce();
}
```

This keeps current call sites stable while the runtime moves underneath.

- [ ] **Step 4: Update the CLI smoke script to use the compatibility facade, not direct collectors**

`scripts/test-cli.ts` should stay simple:

```ts
import { getDashboardData } from '../lib/systemMetrics';

async function main() {
  const data = await getDashboardData();
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 5: Verify the facade layer still serves the old shape**

Run:

```bash
npm run lint
npm run test:cli
```

Expected: JSON output still contains `system`, `gpus`, and `containers` keys.

- [ ] **Step 6: Commit the contracts and facade**

Run:

```bash
git add lib/monitoring/contracts.ts lib/monitoring/topics.ts lib/systemMetrics.ts scripts/test-cli.ts
git commit -m "refactor: introduce monitoring contracts and legacy facade"
```

### Task 4: Implement The In-Memory Bus And Snapshot Projectors

**Files:**
- Create: `lib/monitoring/bus.ts`
- Create: `lib/monitoring/projectors/coreProjector.ts`
- Create: `lib/monitoring/projectors/healthProjector.ts`
- Modify: `lib/monitoring/contracts.ts`

- [ ] **Step 1: Implement a small ring-buffer bus, not a general-purpose MQ**

Create `lib/monitoring/bus.ts` around this concrete API:

```ts
type Consumer = (envelope: MetricEnvelope) => void | Promise<void>;

export interface PublishResult {
  sequence: number;
}

export interface MessageBus {
  publish(envelope: Omit<MetricEnvelope, 'sequence'>): PublishResult;
  subscribe(topic: string, group: string, consumer: Consumer): () => void;
  getQueueStats(): { topicCount: number; groupCount: number; consumerCount: number; droppedMessages: number; };
}
```

Implementation rule:

1. Keep one ring buffer per topic.
2. Broadcast across groups.
3. Broadcast within a group for V1.
4. Track dropped-message count when buffers roll over.

- [ ] **Step 2: Implement the core snapshot projector that rebuilds the legacy dashboard view**

Create `lib/monitoring/projectors/coreProjector.ts` with a shape like:

```ts
export interface CoreProjector {
  apply(envelope: MetricEnvelope): void;
  getSnapshot(): CoreSnapshot;
}
```

Store and merge at least:

1. last system payload
2. last GPU payload
3. last Docker payload
4. last model-config payload

Then build:

```ts
const dashboard: DashboardData = {
  system,
  gpus,
  containers: containers.map((runtime) => ({
    runtime,
    modelConfig: modelConfig[runtime.name] || null,
  })),
};
```

- [ ] **Step 3: Implement the health snapshot projector**

Create `lib/monitoring/projectors/healthProjector.ts` with storage for:

```ts
export interface HealthSnapshot {
  dispatchers: DispatcherState[];
  queue: {
    topicCount: number;
    groupCount: number;
    consumerCount: number;
    droppedMessages: number;
  };
  agents: Array<{
    sourceId: string;
    agentId: string;
    lastSeenAt: number;
    transport: 'http' | 'socket.io';
  }>;
  events: Array<{
    type: 'degraded' | 'recovered' | 'error';
    dispatcher: string;
    message: string;
    timestamp: number;
  }>;
}
```

- [ ] **Step 4: Subscribe both projectors to the bus through named groups**

Use explicit registrations like:

```ts
bus.subscribe(MONITOR_TOPICS.metricsSystem, SUBSCRIPTION_GROUPS.snapshotCore, (event) => coreProjector.apply(event));
bus.subscribe(MONITOR_TOPICS.metricsDocker, SUBSCRIPTION_GROUPS.snapshotCore, (event) => coreProjector.apply(event));
bus.subscribe(MONITOR_TOPICS.metricsGpu, SUBSCRIPTION_GROUPS.snapshotCore, (event) => coreProjector.apply(event));
bus.subscribe(MONITOR_TOPICS.configModel, SUBSCRIPTION_GROUPS.snapshotCore, (event) => coreProjector.apply(event));
```

- [ ] **Step 5: Verify projector behavior with the CLI smoke path**

Run:

```bash
npm run lint
npm run test:cli
```

Expected: snapshot-backed data still serializes to the same top-level shape.

- [ ] **Step 6: Commit the bus and projectors**

Run:

```bash
git add lib/monitoring/bus.ts lib/monitoring/projectors lib/monitoring/contracts.ts
git commit -m "feat: add in-memory monitoring bus and snapshot projectors"
```

### Task 5: Implement Dispatcher Runtime, Docker API Collection, And GPU CLI Collection

**Files:**
- Create: `lib/monitoring/dispatchers/createDispatcher.ts`
- Create: `lib/monitoring/dispatchers/systemDispatcher.ts`
- Create: `lib/monitoring/dispatchers/dockerDispatcher.ts`
- Create: `lib/monitoring/dispatchers/gpuDispatcher.ts`
- Create: `lib/monitoring/dispatchers/modelConfigDispatcher.ts`
- Create: `lib/monitoring/samplers/systemPrimary.ts`
- Create: `lib/monitoring/samplers/systemFallback.ts`
- Create: `lib/monitoring/samplers/dockerApi.ts`
- Create: `lib/monitoring/samplers/dockerCli.ts`
- Create: `lib/monitoring/samplers/gpuPrimary.ts`
- Create: `lib/monitoring/samplers/gpuFallback.ts`
- Create: `lib/monitoring/samplers/modelConfigPrimary.ts`
- Create: `lib/monitoring/samplers/modelConfigFallback.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the Docker API dependency**

Run:

```bash
npm install dockerode
```

Expected: `package.json` and `package-lock.json` add `dockerode`.

- [ ] **Step 2: Build a generic dispatcher state machine once and reuse it**

Create `lib/monitoring/dispatchers/createDispatcher.ts` around this concrete API:

```ts
export interface DispatcherDependencies<TPayload> {
  name: string;
  topic: string;
  metricKey: string;
  config: DispatcherRuntimeConfig;
  sourceId: string;
  agentId: string;
  primary: () => Promise<TPayload>;
  fallback: () => Promise<TPayload>;
  publish: (event: MetricEnvelope<TPayload>) => void;
  publishHealth: (state: DispatcherState, message?: string) => void;
}

export interface RunningDispatcher {
  start(): void;
  stop(): Promise<void>;
  getState(): DispatcherState;
}
```

The implementation must:

1. run on an interval
2. try `primary`
3. try `fallback` on failure
4. enter degraded mode after `degradeAfterFailures`
5. probe recovery after `apiProbeIntervalMs`

- [ ] **Step 3: Implement system samplers**

Use this split:

1. `systemPrimary.ts`
   - Node `os` APIs for CPU/memory
   - `/etc/os-release` or `lsb_release` for OS string
2. `systemFallback.ts`
   - `/proc/stat`, `/proc/meminfo`, and `uname`-style fallback reads

Keep the payload shape equal to legacy `SystemMetrics`.

- [ ] **Step 4: Implement Docker primary and fallback samplers**

`dockerApi.ts` should use `dockerode` roughly like this:

```ts
import Docker from 'dockerode';

const docker = new Docker();

const containers = await docker.listContainers({ all: false });
const stats = await Promise.all(containers.map(async (container) => {
  const instance = docker.getContainer(container.Id);
  const [inspect, streamlessStats] = await Promise.all([
    instance.inspect(),
    instance.stats({ stream: false }),
  ]);
  return { inspect, streamlessStats };
}));
```

`dockerCli.ts` should preserve the current `docker ps`, `docker stats --no-stream`, and `docker inspect` path.

- [ ] **Step 5: Implement GPU samplers with CLI only**

`gpuPrimary.ts` must keep the current structured commands:

```ts
await execFileAsync('nvidia-smi', [
  '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed',
  '--format=csv,noheader,nounits',
]);

await execFileAsync('rocm-smi', ['-a', '--json']);
await execFileAsync('rocm-smi', ['--showmeminfo', 'vram', '--json']);
```

`gpuFallback.ts` should remain CLI-based too, but use narrower compatibility commands if the richer parsing fails. For example:

```ts
await execFileAsync('nvidia-smi', ['--query-gpu=index,name,memory.total,memory.used', '--format=csv,noheader,nounits']);
await execFileAsync('rocm-smi', ['--showmeminfo', 'vram', '--json']);
```

The key rule is: GPU stays `nvidia-smi` and `rocm-smi` only, with primary/fallback profiles implemented inside that constraint.

- [ ] **Step 6: Implement the model-config dispatcher using the unified loader**

Primary and fallback can both rely on file reads, but the fallback should return the last-known-good snapshot if the current file parse fails. That keeps the dispatcher contract consistent without inventing unnecessary shell commands.

- [ ] **Step 7: Wire the concrete dispatchers**

Each dispatcher file should export a factory like:

```ts
export function createDockerDispatcher(deps: SharedRuntimeDeps): RunningDispatcher {
  return createDispatcher({
    name: 'docker-dispatcher',
    topic: MONITOR_TOPICS.metricsDocker,
    metricKey: 'docker.container.stats',
    config: deps.config.dispatchers.docker,
    sourceId: deps.sourceId,
    agentId: deps.agentId,
    primary: () => sampleDockerApi(deps),
    fallback: () => sampleDockerCli(deps),
    publish: deps.publish,
    publishHealth: deps.publishHealth,
  });
}
```

- [ ] **Step 8: Verify collection still works through the CLI entry**

Run:

```bash
npm run lint
npm run test:cli
```

Expected: the JSON output includes live or empty-safe values for system, GPUs, and containers without throwing.

- [ ] **Step 9: Commit dispatchers and samplers**

Run:

```bash
git add package.json package-lock.json lib/monitoring/dispatchers lib/monitoring/samplers
git commit -m "feat: add dispatcher runtime and sampler strategies"
```

### Task 6: Bootstrap The Monitoring Runtime And Rewire Legacy Consumers

**Files:**
- Create: `lib/monitoring/runtime.ts`
- Modify: `lib/systemMetrics.ts`
- Modify: `app/api/metrics/route.ts`
- Modify: `app/api/benchmark-python/route.ts`
- Modify: `scripts/test-cli.ts`

- [ ] **Step 1: Implement a singleton monitoring runtime**

Create `lib/monitoring/runtime.ts` with a concrete singleton API:

```ts
interface MonitoringRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  getDashboardSnapshot(): DashboardData;
  getHealthSnapshot(): HealthSnapshot;
  getBus(): MessageBus;
}

let runtimePromise: Promise<MonitoringRuntime> | null = null;
let runtimeInstance: MonitoringRuntime | null = null;

async function createMonitoringRuntime(): Promise<MonitoringRuntime> {
  const config = await loadAppConfig();
  const bus = createMessageBus();
  const coreProjector = createCoreProjector();
  const healthProjector = createHealthProjector();
  const dispatchers = createAllDispatchers({ bus, config, sourceId: 'local', agentId: 'local-main' });

  const runtime: MonitoringRuntime = {
    async start() {
      subscribeProjectors(bus, coreProjector, healthProjector);
      for (const dispatcher of dispatchers) {
        dispatcher.start();
      }
    },
    async stop() {
      for (const dispatcher of dispatchers) {
        await dispatcher.stop();
      }
    },
    getDashboardSnapshot() {
      return coreProjector.getSnapshot().dashboard;
    },
    getHealthSnapshot() {
      return healthProjector.getSnapshot();
    },
    getBus() {
      return bus;
    },
  };

  await runtime.start();
  return runtime;
}

export async function ensureMonitoringRuntimeStarted(): Promise<MonitoringRuntime> {
  if (runtimeInstance) return runtimeInstance;
  if (!runtimePromise) {
    runtimePromise = createMonitoringRuntime().then((runtime) => {
      runtimeInstance = runtime;
      return runtime;
    });
  }
  return runtimePromise;
}

export function getLegacyDashboardSnapshotOnce(): DashboardData {
  if (!runtimeInstance) {
    throw new Error('Monitoring runtime has not been started yet');
  }
  return runtimeInstance.getDashboardSnapshot();
}

export function getHealthSnapshotOnce(): HealthSnapshot {
  if (!runtimeInstance) {
    throw new Error('Monitoring runtime has not been started yet');
  }
  return runtimeInstance.getHealthSnapshot();
}
```

The runtime start path must:

1. create the bus
2. create projectors
3. subscribe projectors
4. create dispatchers
5. start dispatchers
6. perform an eager first sampling pass when possible

- [ ] **Step 2: Replace route-level caching in `/api/metrics` with snapshot reads**

Reduce `app/api/metrics/route.ts` to this pattern:

```ts
import { NextResponse } from 'next/server';
import { ensureMonitoringRuntimeStarted, getLegacyDashboardSnapshotOnce } from '../../../lib/monitoring/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureMonitoringRuntimeStarted();
  return NextResponse.json(getLegacyDashboardSnapshotOnce());
}
```

Remove the route-local `CACHE_TTL_MS` cache; snapshot freshness is now runtime-owned.

- [ ] **Step 3: Rewire `benchmark-python` to read the snapshot facade instead of direct collectors**

Keep its behavior, but change the data source to:

```ts
const dashboardData = await getDashboardData();
```

where `getDashboardData()` now hits the runtime-backed compatibility facade.

- [ ] **Step 4: Verify the runtime-backed legacy API**

Run:

```bash
PORT=3001 npm run dev
curl -s http://localhost:3001/api/metrics | jq '.system,.gpus,.containers'
```

Expected: JSON is returned immediately from snapshot-backed state.

- [ ] **Step 5: Verify the benchmark route still resolves host metadata**

Run:

```bash
curl -s -X POST http://localhost:3001/api/benchmark-python -H 'Content-Type: application/json' -d '{"port":"8000","model":"demo","concurrency":1,"prompts":["hello"],"runtime":"cpu"}'
```

Expected: route begins streaming SSE output instead of failing on missing collectors.

- [ ] **Step 6: Commit runtime bootstrap and legacy route rewiring**

Run:

```bash
git add lib/monitoring/runtime.ts lib/systemMetrics.ts app/api/metrics/route.ts app/api/benchmark-python/route.ts scripts/test-cli.ts
git commit -m "refactor: serve legacy monitoring routes from runtime snapshots"
```

### Task 7: Add Monitoring Socket Transport, Agent Ingress, And Health APIs

**Files:**
- Create: `lib/monitoring/transport/agentAuth.ts`
- Create: `lib/monitoring/transport/monitorSocket.ts`
- Create: `app/api/agent/report/route.ts`
- Create: `app/api/system-health/route.ts`
- Modify: `server.ts`

- [ ] **Step 1: Add a small shared auth helper for external agents**

Create `lib/monitoring/transport/agentAuth.ts` with:

```ts
import { loadAppConfig } from '../../appConfig';

export async function assertAgentToken(token: string | null): Promise<void> {
  const config = await loadAppConfig();
  if (!config.agent.allowExternalReport) throw new Error('External agent reporting disabled');
  if (!token || token !== config.agent.reportToken) throw new Error('Invalid agent token');
}
```

- [ ] **Step 2: Add an HTTP ingress route for external agents**

Create `app/api/agent/report/route.ts` with this flow:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAgentToken } from '../../../../lib/monitoring/transport/agentAuth';
import { ensureMonitoringRuntimeStarted } from '../../../../lib/monitoring/runtime';

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-agent-token');
  await assertAgentToken(token);
  const runtime = await ensureMonitoringRuntimeStarted();
  const body = await req.json();
  const events = Array.isArray(body) ? body : [body];
  for (const event of events) runtime.getBus().publish(event);
  return NextResponse.json({ accepted: events.length });
}
```

- [ ] **Step 3: Add a health snapshot route**

Create `app/api/system-health/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { ensureMonitoringRuntimeStarted, getHealthSnapshotOnce } from '../../../lib/monitoring/runtime';

export async function GET() {
  await ensureMonitoringRuntimeStarted();
  return NextResponse.json(getHealthSnapshotOnce());
}
```

- [ ] **Step 4: Add monitoring and agent events to `server.ts` without breaking WebShell events**

Add a monitor socket setup function shaped like:

```ts
io.on('connection', (socket) => {
  socket.on('monitor:init', async () => {
    const runtime = await ensureMonitoringRuntimeStarted();
    socket.emit('monitor:snapshot', {
      dashboard: runtime.getDashboardSnapshot(),
      health: runtime.getHealthSnapshot(),
    });
  });

  socket.on('agent:init', async ({ token }) => {
    await assertAgentToken(token);
    socket.data.agentAuthenticated = true;
  });

  socket.on('agent:report', async (event) => {
    if (!socket.data.agentAuthenticated) return;
    const runtime = await ensureMonitoringRuntimeStarted();
    runtime.getBus().publish(event);
  });
});
```

Use distinct event names so WebShell continues to use `init`, `data`, `resize`, and `close` without collision.

- [ ] **Step 5: Bridge bus events to the `ws-broadcast` group**

Subscribe the runtime bus to a socket broadcast handler that emits:

```ts
socket.emit('monitor:event', event);
socket.emit('monitor:health', healthSnapshot);
```

Only broadcast monitoring events; do not reuse WebShell transport semantics.

- [ ] **Step 6: Verify HTTP and socket agent ingress behavior**

Run:

```bash
PORT=3001 npm run dev
curl -s http://localhost:3001/api/system-health
curl -s -X POST http://localhost:3001/api/agent/report -H 'Content-Type: application/json' -H 'x-agent-token: change-me' -d '[]'
```

Expected:

1. `/api/system-health` returns JSON.
2. Agent report returns `{ "accepted": 0 }` for an empty array.

- [ ] **Step 7: Commit transport and health APIs**

Run:

```bash
git add lib/monitoring/transport app/api/agent/report/route.ts app/api/system-health/route.ts server.ts
git commit -m "feat: add monitoring socket transport and agent ingress"
```

### Task 8: Build The Protocol-Aware Client Monitor Store

**Files:**
- Create: `lib/client-monitor/types.ts`
- Create: `lib/client-monitor/store.ts`
- Create: `lib/client-monitor/socket.ts`
- Create: `lib/client-monitor/useMonitorTransport.ts`
- Modify: `app/page.tsx`

- [ ] **Step 1: Define a client-side state contract shared by legacy and modern modes**

Create `lib/client-monitor/types.ts`:

```ts
import type { DashboardData, HealthSnapshot } from '../monitoring/contracts';

export interface ClientMonitorState {
  dashboard: DashboardData | null;
  health: HealthSnapshot | null;
  status: 'idle' | 'loading' | 'live' | 'error';
  error: string | null;
  lastUpdatedAt: number | null;
}
```

- [ ] **Step 2: Build a minimal store that can be updated by fetch or socket events**

Create `lib/client-monitor/store.ts` around this shape:

```ts
export function createClientMonitorStore(initialState?: Partial<ClientMonitorState>) {
  let state: ClientMonitorState = { dashboard: null, health: null, status: 'idle', error: null, lastUpdatedAt: null, ...initialState };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    setSnapshot: (dashboard: DashboardData, health: HealthSnapshot | null) => { state = { ...state, dashboard, health, status: 'live', error: null, lastUpdatedAt: Date.now() }; listeners.forEach((l) => l()); },
    applyEvent: (dashboard: DashboardData, health: HealthSnapshot | null) => { state = { ...state, dashboard, health, status: 'live', lastUpdatedAt: Date.now() }; listeners.forEach((l) => l()); },
    setError: (message: string) => { state = { ...state, status: 'error', error: message }; listeners.forEach((l) => l()); },
  };
}
```

- [ ] **Step 3: Add a protocol-aware transport hook**

Create `lib/client-monitor/useMonitorTransport.ts` with this behavior:

```ts
import useSWR from 'swr';
import { useEffect } from 'react';
import { monitorEnv } from '../../env';

export function useMonitorTransport() {
  if (monitorEnv.monitorProtocolMode === 'legacy') {
    // poll /api/metrics and /api/system-health
  }
  // connect socket.io, emit monitor:init, listen for monitor:snapshot and monitor:event
}
```

The modern path must use the same store as the legacy path.

- [ ] **Step 4: Keep `socket.io` client logic isolated from page components**

Create `lib/client-monitor/socket.ts` with a small helper:

```ts
import { io, Socket } from 'socket.io-client';

export function connectMonitorSocket(): Socket {
  return io({ autoConnect: true });
}
```

- [ ] **Step 5: Replace direct `useSWR('/api/metrics')` usage in `app/page.tsx` with the transport hook**

Replace this current pattern:

```ts
const { data, error, isLoading, isValidating } = useSWR<DashboardData>('/api/metrics', fetcher, { refreshInterval: 2000 });
```

with a hook result shaped like:

```ts
const { dashboard, health, status, error, lastUpdatedAt } = useMonitorTransport();
```

Then map:

1. `dashboard.system`
2. `dashboard.gpus`
3. `dashboard.containers`

without changing the visual content more than necessary.

- [ ] **Step 6: Verify both transport modes render the main page**

Run:

```bash
NEXT_PUBLIC_MONITOR_PROTOCOL_MODE=legacy PORT=3001 npm run dev
curl -s http://localhost:3001 | grep -o '<html'
NEXT_PUBLIC_MONITOR_PROTOCOL_MODE=modern PORT=3001 npm run dev
curl -s http://localhost:3001 | grep -o '<html'
```

Expected: page HTML renders in both modes, and no server-side crash occurs.

- [ ] **Step 7: Commit client monitor transport work**

Run:

```bash
git add lib/client-monitor app/page.tsx env.ts
git commit -m "feat: add protocol-aware client monitoring transport"
```

### Task 9: Add The Read-Only Health Center UI

**Files:**
- Create: `components/health/DispatcherHealthTable.tsx`
- Create: `components/health/QueueHealthCard.tsx`
- Create: `components/health/AgentHealthTable.tsx`
- Create: `app/health/page.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Build small, focused health components instead of another monolithic page**

Use these concrete component props:

```ts
export interface DispatcherHealthTableProps {
  dispatchers: HealthSnapshot['dispatchers'];
}

export interface QueueHealthCardProps {
  queue: HealthSnapshot['queue'];
}

export interface AgentHealthTableProps {
  agents: HealthSnapshot['agents'];
}
```

- [ ] **Step 2: Implement `app/health/page.tsx` using the same transport mode as the main page**

Use this high-level structure:

```tsx
'use client';

import { Typography, Badge, Alert } from 'antd';
import { useMonitorTransport } from '../../lib/client-monitor/useMonitorTransport';

export default function HealthPage() {
  const { health, status, error, lastUpdatedAt } = useMonitorTransport();
  // render dispatcher table, queue card, agent table, event list
}
```

The page must be read-only. Do not add restart/probe/reset buttons.

- [ ] **Step 3: Add navigation from the home page to the health page**

Add one explicit entry point in `app/page.tsx`, for example an Ant Design `Button` or link near the header that routes to `/health`.

- [ ] **Step 4: Verify the health page in both modes**

Run:

```bash
NEXT_PUBLIC_MONITOR_PROTOCOL_MODE=legacy PORT=3001 npm run dev
curl -s http://localhost:3001/health | grep -o '<html'
NEXT_PUBLIC_MONITOR_PROTOCOL_MODE=modern PORT=3001 npm run dev
curl -s http://localhost:3001/health | grep -o '<html'
```

Expected: health page renders in both modes.

- [ ] **Step 5: Commit the health center UI**

Run:

```bash
git add components/health app/health/page.tsx app/page.tsx
git commit -m "feat: add read-only monitoring health center"
```

### Task 10: Update Compatibility Surfaces And Documentation

**Files:**
- Modify: `README.md`
- Modify: `config.default.json`
- Modify: `app/api/benchmark-python/route.ts`
- Modify: `app/api/benchmark-image/route.ts`
- Modify: `app/api/disk-usage/route.ts`
- Optional minor compatibility updates: `components/WebShellModal.tsx`, `app/metrics/page.tsx`

- [ ] **Step 1: Make sure manual-config routes no longer bypass the shared loader**

Re-read and confirm:

1. `app/api/benchmark-python/route.ts`
2. `app/api/benchmark-image/route.ts`
3. `app/api/disk-usage/route.ts`

Each must source config from the shared loader, not a hard-coded `~/.config/kanban/config.json` read.

- [ ] **Step 2: Document the new runtime behavior in `README.md`**

Add these concrete sections:

1. `Protocol Modes`
   - `NEXT_PUBLIC_MONITOR_PROTOCOL_MODE=legacy|modern`
2. `Monitoring Runtime`
   - background dispatchers
   - snapshot-backed HTTP
   - `socket.io` modern mode
3. `Health Center`
   - `/health`
4. `External Agent Reporting`
   - HTTP route
   - `socket.io` events
5. `Verification On Port 3001`

- [ ] **Step 3: Add example `.env` guidance to README without introducing a new secrets file into git**

Document exact commands such as:

```bash
NEXT_PUBLIC_MONITOR_PROTOCOL_MODE=modern ENABLE_EXTERNAL_AGENT=true PORT=3001 npm run dev
```

- [ ] **Step 4: Verify no stale direct-config reads remain**

Run:

```bash
rg "config.json|CONFIG_PATH|fs.existsSync\(|readFileSync\(" app lib scripts
```

Expected: direct-config reads are either gone or clearly unrelated to runtime config.

- [ ] **Step 5: Commit compatibility cleanup and docs**

Run:

```bash
git add README.md config.default.json app/api/benchmark-python/route.ts app/api/benchmark-image/route.ts app/api/disk-usage/route.ts
git commit -m "docs: document monitoring runtime and protocol modes"
```

### Task 11: Final Verification, Production Build, And Port-3001 Smoke Test

**Files:**
- No new files required
- Verify all modified files above

- [ ] **Step 1: Run lint against the full repository**

Run:

```bash
npm run lint
```

Expected: exit code `0`.

- [ ] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected: Next.js production build completes successfully.

- [ ] **Step 3: Verify the legacy mode on port `3001`**

Run:

```bash
NEXT_PUBLIC_MONITOR_PROTOCOL_MODE=legacy PORT=3001 npm run start
```

In another terminal:

```bash
curl -s http://localhost:3001/api/metrics | jq '.system,.gpus,.containers'
curl -s http://localhost:3001/api/system-health | jq '.dispatchers,.queue'
curl -s http://localhost:3001 | grep -o '<html'
curl -s http://localhost:3001/health | grep -o '<html'
```

Expected:

1. Metrics API returns snapshot-backed JSON.
2. Health API returns dispatcher and queue state.
3. Main page and health page render HTML.

- [ ] **Step 4: Verify the modern mode on port `3001`**

Run:

```bash
NEXT_PUBLIC_MONITOR_PROTOCOL_MODE=modern PORT=3001 npm run start
```

In another terminal:

```bash
curl -s http://localhost:3001 | grep -o '<html'
curl -s http://localhost:3001/health | grep -o '<html'
curl -s http://localhost:3001/api/app-config | jq '.protocolMode'
```

Expected:

1. HTML renders for both pages.
2. `/api/app-config` reports `"modern"`.
3. Server logs show monitor socket registration without crashing WebShell wiring.

- [ ] **Step 5: Record final git state and stop the local test process**

Run:

```bash
git status --short
```

Expected: only intended modified files remain, and the port-`3001` test process can be cleanly terminated.

- [ ] **Step 6: Commit the final verification pass**

Run:

```bash
git add .
git commit -m "chore: finalize monitoring architecture refactor"
```

## 4. Implementation Notes That The Engineer Must Not Miss

1. Do not delete `lib/systemMetrics.ts` until all call sites are safely behind the compatibility facade.
2. Do not make the home page directly depend on raw bus envelopes; it must consume stable snapshot-derived data.
3. Do not merge monitor events into WebShell event names. Keep the namespaces separate by event string.
4. Do not let `/api/metrics` keep its own stale mini-cache; the runtime snapshot is already the cache.
5. Do not block this refactor on migrating `app/metrics/page.tsx` to WebSocket. That page can remain independent in V1.
6. Do not introduce GPU libraries beyond `nvidia-smi` and `rocm-smi`.
7. Do not forget the user requirement to verify with port `3001`, not `3000`.
8. Do not push any branch.

## 5. Spec Coverage Checklist

This section maps the approved design to concrete tasks.

1. Standard API for Docker with fallback CLI
   - Task 5
2. GPU restricted to `nvidia-smi` and `rocm-smi`
   - Task 5
3. Initial-load performance via prewarmed dispatcher and snapshots
   - Tasks 4, 5, 6
4. Global queue with topics and subscription groups
   - Tasks 3 and 4
5. Dispatcher architecture with per-source sampler loops
   - Task 5
6. Legacy HTTP plus modern WebSocket compatibility
   - Tasks 6, 7, 8
7. `env.ts` startup switch for protocol mode
   - Task 2 and Task 8
8. Snapshot-backed APIs
   - Task 6
9. External agent reporting via HTTP and `socket.io`
   - Task 7
10. Health center page with degradation visibility
   - Tasks 7 and 9
11. Configurable sampling rates and business parameters
   - Task 2
12. Full verification with build, lint, and port-`3001` runtime
   - Task 11

## 6. Self-Review Notes

Plan quality checks completed while writing:

1. No `TODO`, `TBD`, or placeholder markers are left in this plan.
2. The plan includes the current business context and repository hotspots so a new session can execute it without prior chat history.
3. Type names are consistent across tasks: `DashboardData`, `MetricEnvelope`, `DispatcherState`, `HealthSnapshot`, `monitorEnv`.
4. The GPU strategy is explicitly constrained to `nvidia-smi` and `rocm-smi` only.
5. The plan preserves legacy routes while introducing the new runtime underneath.
