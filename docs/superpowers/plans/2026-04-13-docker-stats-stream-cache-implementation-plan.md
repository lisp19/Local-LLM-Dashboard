# Docker Stats Stream Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Docker primary sampler's slow one-shot stats calls with a persistent stream-backed cache while surfacing a minimal `syncing -> ok` state on container cards.

**Architecture:** Keep the current `docker-dispatcher` and `createDispatcher()` flow unchanged. Modify the Docker sampler path only: add `syncState` to `ContainerMetrics`, wire that state through the existing dashboard badge, and replace `sampleDockerApi()`'s `stats({ stream: false })` calls with a module-local `stats({ stream: true })` cache that warms in the background and is read synchronously during each polling cycle.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, Node.js custom server, Dockerode, Ant Design 6, ESLint 9, `tsx`.

---

## 0. Business Context And Constraints

This repository already has a working monitoring runtime:

1. `lib/monitoring/dispatchers/dockerDispatcher.ts` calls `sampleDockerApi()` as the primary sampler.
2. `lib/monitoring/dispatchers/createDispatcher.ts` treats one full sampler call as one primary success or failure.
3. `app/page.tsx` already renders a container badge with `Syncing`, `OK`, and `Stale` visuals derived from `containerUpdatedAt`.
4. Measured runtime behavior showed `docker.listContainers()` is fast, while `container.stats({ stream: false })` is the actual bottleneck.

### Approved scope for this implementation

1. Do not split the Docker dispatcher.
2. Do not redesign container discovery.
3. Do not change `createDispatcher()` or bus/projector topology.
4. Do not add tests or TDD steps; the user did not ask for them.
5. Keep changes focused on the slow stats path and the existing container-card status badge.

### Required user-visible behavior

1. New or recovering containers show `Syncing` on the card badge.
2. While `Syncing`, CPU displays `0.00%`.
3. While `Syncing`, memory and other non-CPU fields should display correct values as soon as they are available.
4. Once a container has enough stream samples for CPU calculation, the badge switches to green `OK`.
5. The server console should log the warm-up lifecycle for the stream cache.

## 1. Planned File Layout

### Files to modify

1. `lib/monitoring/contracts.ts`
   - Extend `ContainerMetrics` with a minimal `syncState` field.
2. `lib/monitoring/samplers/dockerApi.ts`
   - Replace one-shot Docker stats calls with a module-local persistent stream cache.
3. `lib/monitoring/samplers/dockerCli.ts`
   - Return `syncState: 'ok'` so fallback payloads stay shape-compatible.
4. `app/page.tsx`
   - Drive the existing badge from backend `runtime.syncState` while preserving stale detection from `containerUpdatedAt`.

### Files to inspect but not expected to change

1. `lib/monitoring/dispatchers/dockerDispatcher.ts`
   - Confirm it remains a simple primary/fallback wrapper.
2. `lib/monitoring/dispatchers/createDispatcher.ts`
   - Confirm container-level `syncing` does not require dispatcher-level changes.
3. `lib/monitoring/projectors/coreProjector.ts`
   - Confirm it can continue passing through `ContainerMetrics[]` without code changes.

## 2. Implementation Tasks

### Task 1: Add `syncState` To Runtime Metrics And Reuse The Existing Card Badge

**Files:**
- Modify: `lib/monitoring/contracts.ts`
- Modify: `lib/monitoring/samplers/dockerApi.ts`
- Modify: `lib/monitoring/samplers/dockerCli.ts`
- Modify: `app/page.tsx`

- [ ] **Step 1: Extend `ContainerMetrics` with the minimal sync field**

Edit `lib/monitoring/contracts.ts` so `ContainerMetrics` becomes:

```ts
export interface ContainerMetrics {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  publishedPort: string | null;
  cpuPercent: string;
  memUsage: string;
  memUsedRaw: number;
  gpus: string[];
  syncState: 'syncing' | 'ok';
}
```

This field is intentionally narrow. Do not add extra timestamps, nested objects, or new enum states in the public payload.

- [ ] **Step 2: Make both samplers emit a shape-compatible `syncState` before the stream refactor**

Update `lib/monitoring/samplers/dockerCli.ts` so each pushed metric includes `syncState: 'ok'`:

```ts
    metrics.push({
      id: containerId,
      name: (c.Names ?? c.Name ?? containerId) as string,
      image: (c.Image ?? '') as string,
      status: (c.Status ?? '') as string,
      ports: (c.Ports ?? '') as string,
      publishedPort: extractPublishedPort((c.Ports ?? '') as string),
      cpuPercent: (stat.CPUPerc ?? '0.00%') as string,
      memUsage: (stat.MemUsage ?? '0B / 0B') as string,
      memUsedRaw: parseMemBytes((stat.MemUsage ?? '0B / 0B') as string),
      gpus,
      syncState: 'ok',
    });
```

Update the current `lib/monitoring/samplers/dockerApi.ts` return object the same way so the repo still builds before Task 2 rewrites the file:

```ts
      return {
        id: c.Id.slice(0, 12),
        name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
        image: c.Image,
        status: c.Status,
        ports,
        publishedPort: publishedPort ? String(publishedPort) : null,
        cpuPercent,
        memUsage,
        memUsedRaw: memUsed,
        gpus,
        syncState: 'ok',
      };
```

- [ ] **Step 3: Switch the dashboard badge to prefer backend `syncState` while keeping stale detection**

Replace the existing helper in `app/page.tsx` with:

```tsx
function getContainerSyncState(
  runtimeSyncState: 'syncing' | 'ok' | undefined,
  lastSeenAt: number | null,
): {
  color: string;
  label: string;
  icon: React.ReactNode;
} {
  const ageMs = lastSeenAt ? Date.now() - lastSeenAt : null;

  if (ageMs !== null && ageMs > CONTAINER_STALE_MS) {
    return { color: '#dc2626', label: 'Stale', icon: <CloseCircleFilled /> };
  }

  if (!lastSeenAt || runtimeSyncState === 'syncing') {
    return { color: '#f59e0b', label: 'Syncing', icon: <EllipsisOutlined /> };
  }

  return { color: '#16a34a', label: 'OK', icon: <CheckCircleFilled /> };
}
```

Then update the card call site from:

```tsx
const syncState = getContainerSyncState(containerUpdatedAt[runtime.id] ?? null);
```

to:

```tsx
const syncState = getContainerSyncState(runtime.syncState, containerUpdatedAt[runtime.id] ?? null);
```

This preserves the current `Stale` fallback while letting the backend explicitly control the warm-up state.

- [ ] **Step 4: Run lint and build after the contract and UI wiring change**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
ESLint exits with code 0.
Next.js production build exits with code 0.
```

If build errors point to `ContainerMetrics` type mismatches, fix those before committing. Do not proceed with a partially wired contract.

- [ ] **Step 5: Commit the contract and UI wiring separately**

Run:

```bash
git add lib/monitoring/contracts.ts lib/monitoring/samplers/dockerApi.ts lib/monitoring/samplers/dockerCli.ts app/page.tsx
git commit -m "feat: add docker runtime sync state"
```

Expected:

```text
[branch-name abc1234] feat: add docker runtime sync state
 4 files changed, ...
```

### Task 2: Replace One-Shot Docker Stats With A Persistent Stream Cache

**Files:**
- Modify: `lib/monitoring/samplers/dockerApi.ts`

- [ ] **Step 1: Replace `lib/monitoring/samplers/dockerApi.ts` with the stream-cache implementation below**

Use this full file content:

```ts
import Docker from 'dockerode';
import type { ContainerMetrics } from '../contracts';

const docker = new Docker();

interface DockerStats {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
  };
  memory_stats: {
    usage: number;
    limit: number;
  };
}

interface DockerStatsStreamEntry {
  stream: NodeJS.ReadableStream | null;
  latestStats: DockerStats | null;
  previousStats: DockerStats | null;
  syncState: 'syncing' | 'ok';
  lastUpdateAt: number | null;
  starting: boolean;
  destroyed: boolean;
}

type RunningContainer = Awaited<ReturnType<Docker['listContainers']>>[number];

const inspectCache = new Map<string, { gpus: string[]; expiry: number }>();
const statsStreamCache = new Map<string, DockerStatsStreamEntry>();
const INSPECT_TTL_MS = 30_000;

function calcCpuPercent(current: DockerStats, previous: DockerStats): string {
  const cpuDelta = current.cpu_stats.cpu_usage.total_usage - previous.cpu_stats.cpu_usage.total_usage;
  const systemDelta = current.cpu_stats.system_cpu_usage - previous.cpu_stats.system_cpu_usage;
  const numCpus = current.cpu_stats.online_cpus ?? 1;
  if (systemDelta <= 0 || cpuDelta < 0) return '0.00%';
  return `${((cpuDelta / systemDelta) * numCpus * 100).toFixed(2)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GiB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)}KiB`;
  return `${bytes}B`;
}

function createStatsEntry(): DockerStatsStreamEntry {
  return {
    stream: null,
    latestStats: null,
    previousStats: null,
    syncState: 'syncing',
    lastUpdateAt: null,
    starting: false,
    destroyed: false,
  };
}

function parseStatsChunk(chunk: Buffer): DockerStats | null {
  const raw = chunk.toString('utf8').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DockerStats;
  } catch {
    return null;
  }
}

function getPorts(container: RunningContainer): string {
  return container.Ports.map((port) => {
    if (port.PublicPort) return `${port.PublicPort}->${port.PrivatePort}/${port.Type}`;
    return `${port.PrivatePort}/${port.Type}`;
  }).join(', ');
}

function getPublishedPort(container: RunningContainer): string | null {
  const publishedPort = container.Ports.find((port) => port.PublicPort)?.PublicPort;
  return publishedPort ? String(publishedPort) : null;
}

function getContainerName(container: RunningContainer): string {
  return container.Names[0]?.replace(/^\//, '') ?? container.Id.slice(0, 12);
}

function getCpuDisplay(entry: DockerStatsStreamEntry | undefined): string {
  if (!entry?.latestStats || !entry.previousStats || entry.syncState !== 'ok') {
    return '0.00%';
  }
  return calcCpuPercent(entry.latestStats, entry.previousStats);
}

function getMemoryFields(entry: DockerStatsStreamEntry | undefined): { memUsage: string; memUsedRaw: number } {
  const memUsed = entry?.latestStats?.memory_stats.usage ?? 0;
  const memLimit = entry?.latestStats?.memory_stats.limit ?? 0;
  return {
    memUsage: `${formatBytes(memUsed)} / ${formatBytes(memLimit)}`,
    memUsedRaw: memUsed,
  };
}

async function getGpuBindings(containerId: string): Promise<string[]> {
  const cached = inspectCache.get(containerId);
  if (cached && Date.now() < cached.expiry) return cached.gpus;

  try {
    const container = docker.getContainer(containerId);
    const inspectData = await container.inspect();
    const deviceRequests = inspectData.HostConfig?.DeviceRequests ?? [];
    const gpus: string[] = [];
    for (const req of deviceRequests) {
      if (req.Capabilities?.some((cap) => cap.includes('gpu'))) {
        if (req.DeviceIDs && req.DeviceIDs.length > 0) {
          gpus.push(...req.DeviceIDs);
        } else if (req.Count === -1) {
          gpus.push('all');
        } else if (req.Count) {
          gpus.push(String(req.Count));
        }
      }
    }
    inspectCache.set(containerId, { gpus, expiry: Date.now() + INSPECT_TTL_MS });
    return gpus;
  } catch {
    return [];
  }
}

function ensureStatsStream(containerId: string, containerName: string): void {
  const existing = statsStreamCache.get(containerId);
  if (existing?.stream || existing?.starting) return;

  const entry = existing ?? createStatsEntry();
  entry.starting = true;
  entry.destroyed = false;
  entry.syncState = 'syncing';
  statsStreamCache.set(containerId, entry);

  console.log(`[docker-stats] starting stream for ${containerName} (${containerId.slice(0, 12)})`);

  void (async () => {
    try {
      const stream = await docker.getContainer(containerId).stats({ stream: true }) as NodeJS.ReadableStream;
      if (entry.destroyed) {
        stream.destroy();
        entry.starting = false;
        return;
      }

      entry.stream = stream;
      entry.starting = false;

      stream.on('data', (chunk: Buffer) => {
        const stats = parseStatsChunk(chunk);
        if (!stats) return;

        const hadPreviousSample = entry.latestStats !== null;
        if (entry.latestStats) {
          entry.previousStats = entry.latestStats;
        }
        entry.latestStats = stats;
        entry.lastUpdateAt = Date.now();

        if (!hadPreviousSample) {
          console.log(`[docker-stats] syncing ${containerName} (${containerId.slice(0, 12)}): first stats received`);
          return;
        }

        if (entry.syncState !== 'ok') {
          console.log(`[docker-stats] ok ${containerName} (${containerId.slice(0, 12)}): cpu samples ready`);
        }
        entry.syncState = 'ok';
      });

      stream.on('error', (error: Error) => {
        if (entry.destroyed) return;
        console.error(`[docker-stats] stream error for ${containerName} (${containerId.slice(0, 12)}): ${error.message}`);
        if (entry.stream === stream) {
          entry.stream = null;
        }
        entry.starting = false;
        entry.syncState = 'syncing';
      });

      stream.on('close', () => {
        if (entry.destroyed) return;
        console.warn(`[docker-stats] stream closed for ${containerName} (${containerId.slice(0, 12)}), will recreate on next sample`);
        if (entry.stream === stream) {
          entry.stream = null;
        }
        entry.starting = false;
        entry.syncState = 'syncing';
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[docker-stats] failed to start stream for ${containerName} (${containerId.slice(0, 12)}): ${message}`);
      entry.stream = null;
      entry.starting = false;
      entry.syncState = 'syncing';
    }
  })();
}

function cleanupMissingStreams(activeIds: Set<string>): void {
  for (const [containerId, entry] of statsStreamCache.entries()) {
    if (activeIds.has(containerId)) continue;

    entry.destroyed = true;
    entry.stream?.destroy();
    statsStreamCache.delete(containerId);
    console.log(`[docker-stats] removed stream cache for ${containerId.slice(0, 12)}`);
  }
}

function buildContainerMetric(
  container: RunningContainer,
  entry: DockerStatsStreamEntry | undefined,
  gpus: string[],
): ContainerMetrics {
  const { memUsage, memUsedRaw } = getMemoryFields(entry);

  return {
    id: container.Id.slice(0, 12),
    name: getContainerName(container),
    image: container.Image,
    status: container.Status,
    ports: getPorts(container),
    publishedPort: getPublishedPort(container),
    cpuPercent: getCpuDisplay(entry),
    memUsage,
    memUsedRaw,
    gpus,
    syncState: entry?.syncState ?? 'syncing',
  };
}

export async function sampleDockerApi(): Promise<ContainerMetrics[]> {
  const containers = await docker.listContainers({ all: false });
  const activeIds = new Set(containers.map((container) => container.Id));
  cleanupMissingStreams(activeIds);

  if (containers.length === 0) return [];

  const settled = await Promise.allSettled(
    containers.map(async (container) => {
      const containerName = getContainerName(container);
      ensureStatsStream(container.Id, containerName);
      const gpus = await getGpuBindings(container.Id);
      const entry = statsStreamCache.get(container.Id);
      return buildContainerMetric(container, entry, gpus);
    }),
  );

  const metrics = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));

  if (metrics.length === 0) {
    throw new Error('Docker API sampling failed for all running containers');
  }

  return metrics;
}
```

This implementation keeps the old inspect cache, does not touch dispatcher code, and confines stream state to the Docker sampler layer.

- [ ] **Step 2: Run a manual warm-up verification command against the sampler**

Run:

```bash
npx tsx -e "import { sampleDockerApi } from './lib/monitoring/samplers/dockerApi.ts'; const run = async () => { console.time('first'); const first = await sampleDockerApi(); console.timeEnd('first'); console.log(first.map(({ name, syncState, cpuPercent, memUsage }) => ({ name, syncState, cpuPercent, memUsage }))); await new Promise((resolve) => setTimeout(resolve, 2200)); console.time('second'); const second = await sampleDockerApi(); console.timeEnd('second'); console.log(second.map(({ name, syncState, cpuPercent, memUsage }) => ({ name, syncState, cpuPercent, memUsage }))); }; run().catch((error) => { console.error(error); process.exit(1); });"
```

Expected:

```text
The first printed array shows one or more containers with syncState: 'syncing' and cpuPercent: '0.00%'.
The second printed array shows warmed containers with syncState: 'ok' and real memory values still present.
The console prints [docker-stats] lifecycle logs for stream start, syncing, and ok transitions.
```

If the second call still blocks for the original `1.5s~2.0s` behavior, stop and inspect whether the stream cache is actually being reused or recreated every cycle.

- [ ] **Step 3: Run lint and build after the sampler rewrite**

Run:

```bash
npm run lint
npm run build
```

Expected:

```text
ESLint exits with code 0.
Next.js production build exits with code 0.
```

- [ ] **Step 4: Commit the stream-cache implementation**

Run:

```bash
git add lib/monitoring/samplers/dockerApi.ts
git commit -m "feat: cache docker stats streams for runtime sampling"
```

Expected:

```text
[branch-name def5678] feat: cache docker stats streams for runtime sampling
 1 file changed, ...
```

## 3. Final Verification Checklist

Before considering the work done, rerun these checks in the working tree that contains both commits:

1. `npm run lint`
2. `npm run build`
3. the `npx tsx -e` sampler warm-up command from Task 2
4. `git status --short`

Expected final state:

1. lint passes
2. build passes
3. sampler command shows `syncing -> ok` progression
4. `git status --short` is empty unless repo tooling generated tracked files that belong to the same change

## 4. Commit Sequence

Use these commit messages in order:

1. `feat: add docker runtime sync state`
2. `feat: cache docker stats streams for runtime sampling`

## 5. Notes For The Implementer

1. Do not move the stream cache into dispatcher lifecycle code during this implementation. The approved design intentionally keeps state local to the sampler.
2. Do not treat per-container `syncing` as a dispatcher failure. The dispatcher should only fall back when the sampler cannot produce a meaningful overall snapshot.
3. Do not remove the current `Stale` UI state. Backend `syncState` controls warm-up; frontend freshness still controls stale rendering.
4. If `dockerApi.ts` becomes unreadable during implementation, extract one small helper file only after the in-file version is working and verified.
