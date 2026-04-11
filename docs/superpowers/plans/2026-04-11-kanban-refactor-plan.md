# Kanban Dashboard Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Kanban Dashboard to a modern Dispatcher-Agent-MQ architecture with pure JS message queues, standard API data collection, dual-protocol reporting, and a WebSocket-first frontend.

**Architecture:** A central `EventBus` handles pub/sub messaging. `Dispatcher` classes collect data via advanced APIs (falling back to CLI on failure) and publish to the bus. A `KVCache` consumes these messages to serve legacy HTTP requests O(1). The WebSocket server pushes updates to the frontend and accepts data from external agents.

**Tech Stack:** Next.js, Node.js (`EventEmitter`), `dockerode` (pure JS), `systeminformation` (pure JS), Socket.io.

## ⚠️ Strict Development Guidelines
1. **NO CODE MODIFICATION until the user explicitly confirms this plan.**
2. **NO PROCESS KILLING OR RESTARTING.** You are a developer, not an operator. Do not restart the Next.js server or kill existing node processes.
3. **NO GIT PUSH.** Do not push to remote.
4. **BRANCHING:** Start by creating a new branch `feat/kanban-refactor` based on `dev`.
5. **COMMITS:** Commit at the end of each step.

---

### Task 0: Git Branch Setup

- [ ] **Step 1: Create and checkout new branch**

```bash
git fetch origin dev || true
git checkout -b feat/kanban-refactor origin/dev || git checkout -b feat/kanban-refactor
```

### Task 1: Setup Dependencies and EventBus

**Files:**
- Modify: `/home/lsp/kanban/package.json`
- Create: `/home/lsp/kanban/lib/mq/EventBus.ts`

- [ ] **Step 1: Install new dependencies**

```bash
npm install dockerode systeminformation
npm install -D @types/dockerode
```

- [ ] **Step 2: Implement EventBus**

```typescript
// /home/lsp/kanban/lib/mq/EventBus.ts
import { EventEmitter } from 'events';

export class EventBus {
  private static instance: EventBus;
  private emitter: EventEmitter;

  private constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  public publish(topic: string, payload: any): void {
    this.emitter.emit(topic, payload);
  }

  public subscribe(topic: string, handler: (payload: any) => void): () => void {
    this.emitter.on(topic, handler);
    return () => {
      this.emitter.off(topic, handler);
    };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json lib/mq/EventBus.ts
git commit -m "feat: implement EventBus and add dependencies"
```

### Task 2: Implement Configurable BaseDispatcher and KVCache

**Files:**
- Modify: `/home/lsp/kanban/config.default.json` (Add config template)
- Create: `/home/lsp/kanban/lib/dispatchers/BaseDispatcher.ts`
- Create: `/home/lsp/kanban/lib/cache/KVCache.ts`

- [ ] **Step 1: Update Config Template**

Read `config.default.json` and add sampling rates/business parameters.
```json
// Add to config.default.json
  "dispatcher": {
    "systemInterval": 2000,
    "dockerInterval": 5000,
    "gpuInterval": 3000,
    "maxErrorsBeforeDegrade": 3
  }
```

- [ ] **Step 2: Implement BaseDispatcher**

```typescript
// /home/lsp/kanban/lib/dispatchers/BaseDispatcher.ts
import { EventBus } from '../mq/EventBus';

export interface DispatcherState {
  name: string;
  status: 'healthy' | 'degraded' | 'error';
  errorCount: number;
  currentMode: 'api' | 'cli';
}

export abstract class BaseDispatcher<T> {
  protected name: string;
  protected topic: string;
  protected intervalMs: number;
  protected errorCount: number = 0;
  protected maxErrorsBeforeDegrade: number;
  protected currentMode: 'api' | 'cli' = 'api';
  protected timer: NodeJS.Timeout | null = null;
  protected bus: EventBus;

  constructor(name: string, topic: string, intervalMs: number = 5000, maxErrors: number = 3) {
    this.name = name;
    this.topic = topic;
    this.intervalMs = intervalMs;
    this.maxErrorsBeforeDegrade = maxErrors;
    this.bus = EventBus.getInstance();
  }

  protected abstract fetchStandardAPI(): Promise<T>;
  protected abstract fetchFallbackCLI(): Promise<T>;

  public start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  protected async tick() {
    let data: T | null = null;
    try {
      if (this.currentMode === 'api') {
        data = await this.fetchStandardAPI();
        this.errorCount = 0; // Reset on success
      } else {
        data = await this.fetchFallbackCLI();
      }
    } catch (error) {
      console.error(`[${this.name}] Fetch error:`, error);
      this.errorCount++;
      
      if (this.currentMode === 'api' && this.errorCount >= this.maxErrorsBeforeDegrade) {
        console.warn(`[${this.name}] Degrading to CLI mode after ${this.errorCount} errors.`);
        this.currentMode = 'cli';
      }
      
      if (this.currentMode === 'api') {
        try {
           data = await this.fetchFallbackCLI();
        } catch (fallbackErr) {
           console.error(`[${this.name}] Fallback CLI also failed:`, fallbackErr);
        }
      }
    }

    if (data) {
      this.bus.publish(this.topic, data);
    }
    this.publishHealth();
  }

  protected publishHealth() {
    const state: DispatcherState = {
      name: this.name,
      status: this.currentMode === 'api' ? 'healthy' : 'degraded',
      errorCount: this.errorCount,
      currentMode: this.currentMode
    };
    this.bus.publish('system:health', state);
  }
}
```

- [ ] **Step 3: Implement KVCache**

```typescript
// /home/lsp/kanban/lib/cache/KVCache.ts
import { EventBus } from '../mq/EventBus';

export class KVCache {
  private static instance: KVCache;
  private cache: Map<string, any> = new Map();
  private bus: EventBus;

  private constructor() {
    this.bus = EventBus.getInstance();
    this.setupSubscriptions();
  }

  public static getInstance(): KVCache {
    if (!KVCache.instance) {
      KVCache.instance = new KVCache();
    }
    return KVCache.instance;
  }

  private setupSubscriptions() {
    const topics = ['metrics:system', 'metrics:gpu', 'metrics:docker', 'system:health'];
    topics.forEach(topic => {
      this.bus.subscribe(topic, (data) => {
        if (topic === 'system:health') {
           const healthMap = this.cache.get('system:health') || {};
           healthMap[data.name] = data;
           this.cache.set(topic, healthMap);
        } else {
           this.cache.set(topic, data);
        }
      });
    });
  }

  public get(key: string): any {
    return this.cache.get(key);
  }

  public getAll(): Record<string, any> {
    return Object.fromEntries(this.cache.entries());
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add config.default.json lib/dispatchers/BaseDispatcher.ts lib/cache/KVCache.ts
git commit -m "feat: implement BaseDispatcher with configurable intervals and KVCache"
```

### Task 3: Implement Specific Dispatchers (System, Docker)

**Files:**
- Create: `/home/lsp/kanban/lib/dispatchers/SystemDispatcher.ts`
- Create: `/home/lsp/kanban/lib/dispatchers/DockerDispatcher.ts`

- [ ] **Step 1: Implement SystemDispatcher**

```typescript
// /home/lsp/kanban/lib/dispatchers/SystemDispatcher.ts
import { BaseDispatcher } from './BaseDispatcher';
import { getSystemMetrics, SystemMetrics } from '../systemMetrics';
import si from 'systeminformation';

export class SystemDispatcher extends BaseDispatcher<SystemMetrics> {
  constructor(intervalMs: number, maxErrors: number) {
    super('System', 'metrics:system', intervalMs, maxErrors);
  }

  protected async fetchStandardAPI(): Promise<SystemMetrics> {
    const [cpu, mem, osInfo] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.osInfo()
    ]);

    return {
      cpuUsage: Math.round(cpu.currentLoad * 100) / 100,
      cpuCores: cpu.cpus.length,
      cpuModel: 'Standard API CPU',
      osRelease: `${osInfo.distro} ${osInfo.release}`,
      memory: {
        total: mem.total,
        used: mem.active,
        free: mem.free
      }
    };
  }

  protected async fetchFallbackCLI(): Promise<SystemMetrics> {
    return await getSystemMetrics();
  }
}
```

- [ ] **Step 2: Implement DockerDispatcher**

```typescript
// /home/lsp/kanban/lib/dispatchers/DockerDispatcher.ts
import { BaseDispatcher } from './BaseDispatcher';
import { getDockerContainers, ContainerMetrics } from '../systemMetrics';
import Docker from 'dockerode';

export class DockerDispatcher extends BaseDispatcher<ContainerMetrics[]> {
  private docker: Docker;

  constructor(intervalMs: number, maxErrors: number) {
    super('Docker', 'metrics:docker', intervalMs, maxErrors);
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  protected async fetchStandardAPI(): Promise<ContainerMetrics[]> {
    const containers = await this.docker.listContainers();
    const metrics: ContainerMetrics[] = [];

    for (const c of containers) {
      metrics.push({
        id: c.Id.substring(0, 12),
        name: c.Names[0].replace('/', ''),
        image: c.Image,
        status: c.Status,
        ports: c.Ports.map(p => `${p.PublicPort}:${p.PrivatePort}`).join(', '),
        cpuPercent: 'API (N/A)', 
        memUsage: 'API (N/A)',
        memUsedRaw: 0,
        gpus: []
      });
    }
    return metrics;
  }

  protected async fetchFallbackCLI(): Promise<ContainerMetrics[]> {
    return await getDockerContainers();
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/dispatchers/SystemDispatcher.ts lib/dispatchers/DockerDispatcher.ts
git commit -m "feat: implement System and Docker dispatchers"
```

### Task 4: Initialize Dispatchers and Refactor API Route

**Files:**
- Create: `/home/lsp/kanban/lib/dispatchers/index.ts`
- Modify: `/home/lsp/kanban/app/api/metrics/route.ts`

- [ ] **Step 1: Initialize Dispatchers with Config**

```typescript
// /home/lsp/kanban/lib/dispatchers/index.ts
import { SystemDispatcher } from './SystemDispatcher';
import { DockerDispatcher } from './DockerDispatcher';
import { KVCache } from '../cache/KVCache';
import fs from 'fs';
import path from 'path';

let initialized = false;

export function initDispatchers() {
  if (initialized) return;
  
  KVCache.getInstance();

  // Load config
  let config = { dispatcher: { systemInterval: 2000, dockerInterval: 5000, maxErrorsBeforeDegrade: 3 } };
  try {
    const configPath = path.join(process.cwd(), 'config.default.json');
    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(fileContent);
    if (parsed.dispatcher) {
      config.dispatcher = { ...config.dispatcher, ...parsed.dispatcher };
    }
  } catch (e) {
    console.warn('Failed to load dispatcher config, using defaults', e);
  }

  const sys = new SystemDispatcher(config.dispatcher.systemInterval, config.dispatcher.maxErrorsBeforeDegrade);
  const docker = new DockerDispatcher(config.dispatcher.dockerInterval, config.dispatcher.maxErrorsBeforeDegrade);
  
  sys.start();
  docker.start();
  
  initialized = true;
  console.log('Dispatchers initialized with config:', config.dispatcher);
}
```

- [ ] **Step 2: Refactor `/api/metrics/route.ts` to use KVCache**

```typescript
// /home/lsp/kanban/app/api/metrics/route.ts
import { NextResponse } from 'next/server';
import { KVCache } from '../../../lib/cache/KVCache';
import { initDispatchers } from '../../../lib/dispatchers';

initDispatchers();

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cache = KVCache.getInstance();
    
    const system = cache.get('metrics:system') || { cpuUsage: 0, memory: { total: 0, used: 0, free: 0 }};
    const containers = cache.get('metrics:docker') || [];
    const gpus = cache.get('metrics:gpu') || []; 
    
    const data = {
      system,
      gpus,
      containers: containers.map((c: any) => ({ runtime: c, modelConfig: null }))
    };

    return NextResponse.json(data);
  } catch (error) {
    console.error('API Metrics Error:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/dispatchers/index.ts app/api/metrics/route.ts
git commit -m "feat: init dispatchers with config and refactor metrics API"
```

### Task 5: Implement Agent Reporting Endpoints (Dual Protocol)

**Files:**
- Create: `/home/lsp/kanban/app/api/agent/report/route.ts`
- Modify: `/home/lsp/kanban/server.js`

- [ ] **Step 1: Implement HTTP Report Endpoint**

```typescript
// /home/lsp/kanban/app/api/agent/report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { EventBus } from '../../../../lib/mq/EventBus';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topic, data } = body;

    if (!topic || !data) {
      return NextResponse.json({ error: 'Topic and data are required' }, { status: 400 });
    }

    EventBus.getInstance().publish(topic, data);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Agent Report API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add WebSocket Agent Reporting to `server.js`**

```javascript
// Add to /home/lsp/kanban/server.js inside io.on('connection')
    socket.on('agent:report', ({ topic, data, token }) => {
       // Requires EventBus to be compiled/accessible or handled via an internal HTTP call if separated
       console.log(`Received agent report for topic: ${topic}`);
       // Implementation detail to be filled during dev based on Next.js setup
    });
```

- [ ] **Step 3: Commit**

```bash
git add app/api/agent/report/route.ts server.js
git commit -m "feat: add dual protocol agent reporting endpoints"
```

### Task 6: Health Dashboard UI

**Files:**
- Create: `/home/lsp/kanban/app/health/page.tsx`
- Create: `/home/lsp/kanban/app/api/health/route.ts`

- [ ] **Step 1: Create Health API Route**

```typescript
// /home/lsp/kanban/app/api/health/route.ts
import { NextResponse } from 'next/server';
import { KVCache } from '../../../lib/cache/KVCache';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cache = KVCache.getInstance();
  const healthData = cache.get('system:health') || {};
  return NextResponse.json(healthData);
}
```

- [ ] **Step 2: Create Health Page UI**

```tsx
// /home/lsp/kanban/app/health/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { Card, Table, Tag } from 'antd';

export default function HealthPage() {
  const [healthData, setHealthData] = useState<any[]>([]);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        setHealthData(Object.values(data));
      } catch (e) {
        console.error(e);
      }
    };
    
    fetchHealth();
    const interval = setInterval(fetchHealth, 2000);
    return () => clearInterval(interval);
  }, []);

  const columns = [
    { title: 'Dispatcher', dataIndex: 'name', key: 'name' },
    { 
      title: 'Status', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'healthy' ? 'green' : (status === 'degraded' ? 'orange' : 'red')}>
          {status?.toUpperCase()}
        </Tag>
      )
    },
    { title: 'Mode', dataIndex: 'currentMode', key: 'mode' },
    { title: 'Errors', dataIndex: 'errorCount', key: 'errors' },
  ];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">System Health</h1>
      <Card>
        <Table dataSource={healthData} columns={columns} rowKey="name" pagination={false} />
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/health/page.tsx app/api/health/route.ts
git commit -m "feat: add health API and dashboard UI"
```
