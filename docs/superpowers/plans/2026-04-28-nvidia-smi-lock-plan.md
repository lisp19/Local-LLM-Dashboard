# Nvidia-SMI Global Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a global lock and request deduplication mechanism for `nvidia-smi` to prevent concurrent executions from consuming system resources.

**Architecture:** We will introduce an `nvidiaRunner.ts` module that maintains a global mutex lock for executing `nvidia-smi` and a Map of pending promises to deduplicate identical concurrent requests. We will then refactor the existing samplers to use this new runner.

**Tech Stack:** TypeScript, Node.js `child_process`

---

### Task 1: Create the Nvidia Runner Module

**Files:**
- Create: `lib/monitoring/samplers/nvidiaRunner.ts`

- [ ] **Step 1: Write the implementation**

Create `lib/monitoring/samplers/nvidiaRunner.ts` with the following content:

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execFileAsync = promisify(execFile);

// Global state for deduplication and locking
const pendingPromises = new Map<string, Promise<string>>();
let isRunning = false;
const queue: (() => void)[] = [];

async function acquireLock(): Promise<void> {
  if (!isRunning) {
    isRunning = true;
    return;
  }
  return new Promise<void>((resolve) => {
    queue.push(resolve);
  });
}

function releaseLock(): void {
  if (queue.length > 0) {
    const next = queue.shift();
    if (next) next();
  } else {
    isRunning = false;
  }
}

async function findBinary(name: string, extraPaths: string[] = []): Promise<string> {
  const paths = [...extraPaths, '/usr/local/bin', '/usr/bin', '/bin'];
  for (const p of paths) {
    const fullPath = path.join(p, name);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // continue
    }
  }
  return name;
}

export async function runNvidiaSmi(args: string[], deduplicationKey: string): Promise<string> {
  // 1. Check for existing identical request
  if (pendingPromises.has(deduplicationKey)) {
    return pendingPromises.get(deduplicationKey)!;
  }

  // 2. Create the execution promise
  const promise = (async () => {
    await acquireLock();
    try {
      const nvidiaSmi = await findBinary('nvidia-smi');
      const { stdout } = await execFileAsync(nvidiaSmi, args);
      return stdout;
    } finally {
      releaseLock();
    }
  })();

  // 3. Store in pending map and clean up when done
  pendingPromises.set(deduplicationKey, promise);
  promise.finally(() => {
    pendingPromises.delete(deduplicationKey);
  });

  return promise;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/monitoring/samplers/nvidiaRunner.ts
git commit -m "feat: add nvidiaRunner with mutex and deduplication"
```

### Task 2: Refactor gpuPrimary.ts

**Files:**
- Modify: `lib/monitoring/samplers/gpuPrimary.ts`

- [ ] **Step 1: Update imports and `sampleNvidia` function**

In `lib/monitoring/samplers/gpuPrimary.ts`:
1. Remove `execFileAsync`, `findBinary`, `path`, `fs` imports if they are no longer used by AMD. Wait, AMD sampler still uses `execFileAsync` and `findBinary`. Keep them for AMD.
2. Import `runNvidiaSmi` from `./nvidiaRunner`.
3. Modify `sampleNvidia` to use `runNvidiaSmi`.

```typescript
// Add to imports:
import { runNvidiaSmi } from './nvidiaRunner';

// Replace sampleNvidia function:
async function sampleNvidia(): Promise<GpuMetrics[]> {
  const stdout = await runNvidiaSmi([
    '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed',
    '--format=csv,noheader,nounits',
  ], 'primary');

  const lines = stdout.trim().split('\n');
  return lines
    .map((line) => {
      const parts = line.split(',').map((s) => s.trim());
      return {
        id: parts[0] ?? '',
        name: parts[1] ?? '',
        type: 'Nvidia' as const,
        utilization: parts[2] ? `${parts[2]}%` : '0%',
        memoryUsed: parts[3] ? `${parts[3]} MiB` : '0 MiB',
        memoryTotal: parts[4] ? `${parts[4]} MiB` : '0 MiB',
        temperature: parts[5] ? `${parts[5]} °C` : '-',
        powerDraw: parts[6] ? `${Math.round(parseFloat(parts[6]))}` : '0',
        powerLimit: parts[7] ? `${Math.round(parseFloat(parts[7]))}` : '0',
        fanSpeed: parts[8] && parts[8] !== 'N/A' ? `${parts[8]}%` : '-',
      };
    })
    .filter((g) => g.id);
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/monitoring/samplers/gpuPrimary.ts
git commit -m "refactor: use nvidiaRunner in gpuPrimary sampler"
```

### Task 3: Refactor gpuFallback.ts

**Files:**
- Modify: `lib/monitoring/samplers/gpuFallback.ts`

- [ ] **Step 1: Update imports and `sampleNvidiaFallback` function**

In `lib/monitoring/samplers/gpuFallback.ts`:
1. Import `runNvidiaSmi` from `./nvidiaRunner`.
2. Modify `sampleNvidiaFallback` to use `runNvidiaSmi`.

```typescript
// Add to imports:
import { runNvidiaSmi } from './nvidiaRunner';

// Replace sampleNvidiaFallback function:
async function sampleNvidiaFallback(): Promise<GpuMetrics[]> {
  const stdout = await runNvidiaSmi([
    '--query-gpu=index,name,memory.total,memory.used',
    '--format=csv,noheader,nounits',
  ], 'fallback');

  const lines = stdout.trim().split('\n');
  return lines
    .map((line) => {
      const parts = line.split(',').map((s) => s.trim());
      return {
        id: parts[0] ?? '',
        name: parts[1] ?? '',
        type: 'Nvidia' as const,
        utilization: '-',
        memoryUsed: parts[3] ? `${parts[3]} MiB` : '0 MiB',
        memoryTotal: parts[2] ? `${parts[2]} MiB` : '0 MiB',
        temperature: '-',
        powerDraw: '-',
        powerLimit: '-',
        fanSpeed: '-',
      };
    })
    .filter((g) => g.id);
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/monitoring/samplers/gpuFallback.ts
git commit -m "refactor: use nvidiaRunner in gpuFallback sampler"
```
