# Docker Stats Stream Cache Design

## Background

The current Docker primary sampler lives in `lib/monitoring/samplers/dockerApi.ts` and is called by `lib/monitoring/dispatchers/dockerDispatcher.ts` through the shared `createDispatcher()` polling loop.

The current sampling chain is:

1. call `docker.listContainers({ all: false })`
2. for each running container, call `container.stats({ stream: false })`
3. in parallel, call cached `container.inspect()` for GPU bindings
4. assemble `ContainerMetrics[]`

Measured behavior in the current environment shows:

1. `listContainers()` completes in about `20ms`
2. `inspect()` completes in about `3ms` to `4ms` and already has a `30s` TTL cache
3. `stats({ stream: false })` is the dominant cost and commonly takes about `1.6s` to `2.0s`
4. repeated end-to-end `sampleDockerApi()` calls stabilize around `~2.0s`

This means the current bottleneck is not container discovery. The bottleneck is that every sampling cycle re-enters Docker's one-shot stats path.

Additional validation shows that `stats({ stream: true })` can keep a long-lived stream per container and refresh approximately once per second. After the stream is warm, reading the latest in-memory stats snapshot is effectively immediate, while the initial warm-up still takes one or two samples before CPU percentage is trustworthy.

## Goals

1. Remove the Docker stats critical path from the per-cycle synchronous sampling flow.
2. Keep the existing dispatcher architecture, topics, projectors, and fallback behavior intact.
3. Keep container discovery as-is; do not redesign the discovery flow or split dispatchers.
4. Expose a minimal per-container sync state so the UI can show `Syncing` during warm-up and `OK` once stats are ready.
5. During warm-up, show correct non-CPU fields when available, keep CPU at `0.00%`, and log the warm-up lifecycle to the server console.

## Non-Goals

1. Do not change `createDispatcher()` scheduling semantics.
2. Do not split Docker monitoring into multiple dispatchers or subtasks.
3. Do not redesign the message bus, projector layout, or dashboard transport flow.
4. Do not optimize `listContainers()` frequency; measured evidence shows that is not the bottleneck.
5. Do not add a large stream supervision framework or durable cache.

## Recommended Approach

Keep `sampleDockerApi()` as the primary Docker sampler entry point, but replace the expensive per-cycle `stats({ stream: false })` calls with a module-local persistent stream cache built on `stats({ stream: true })`.

The refactor stays local to the Docker sampler path:

1. `sampleDockerApi()` still lists running containers every cycle.
2. For each listed container, the sampler ensures a persistent stats stream exists.
3. The sampler reads the latest cached stats from memory instead of awaiting a fresh one-shot stats call.
4. GPU binding lookup continues using the existing inspect cache.
5. The sampler returns a normal `ContainerMetrics[]` payload with one additional field: `syncState`.

This keeps the current dispatcher flow unchanged while moving the bottleneck out of the synchronous sampling path.

## Current-State Constraints

Relevant existing behavior:

1. `lib/monitoring/dispatchers/dockerDispatcher.ts`
   - uses `sampleDockerApi()` as `primary`
   - uses `sampleDockerCli()` as `fallback`
2. `lib/monitoring/dispatchers/createDispatcher.ts`
   - treats the whole sampler call as one primary success or failure unit
   - falls back only when the sampler throws or times out
3. `lib/monitoring/contracts.ts`
   - `ContainerMetrics` currently contains runtime fields only and no explicit sync/warm-up state
4. `app/page.tsx`
   - already renders a per-container status badge
   - currently derives badge state from `containerUpdatedAt`
   - already supports `Syncing`, `OK`, and `Stale` visual states

The design should reuse those seams instead of creating new runtime concepts.

## Architecture

### Data Flow

The new Docker primary path becomes:

1. `docker.listContainers({ all: false })`
2. for each running container, call `ensureStream(containerId)`
3. read the latest in-memory stats entry for that container
4. read GPU bindings from the existing inspect cache
5. assemble `ContainerMetrics[]`
6. clean up stream entries for containers no longer returned by `listContainers()`

No changes are required in:

1. dispatcher registration
2. message publishing
3. projector application
4. socket or HTTP transport

### Stream Cache Scope

The stream cache should remain local to the Docker sampler layer.

Implementation options:

1. keep it inside `lib/monitoring/samplers/dockerApi.ts`
2. if the file becomes noisy, extract one small helper such as `lib/monitoring/samplers/dockerStatsStreamCache.ts`

The recommendation is to start with the smallest version that keeps the code readable. The architecture does not require a dispatcher-level service.

### Stream Entry Model

Each running container ID gets one in-memory entry with the minimum state required to support warm-up, steady-state reads, and reconnects.

Suggested internal shape:

```ts
interface DockerStatsStreamEntry {
  stream: NodeJS.ReadableStream | null;
  latestStats: DockerStats | null;
  previousStats: DockerStats | null;
  syncState: 'syncing' | 'ok';
  lastUpdateAt: number | null;
  starting: boolean;
  destroyed: boolean;
}
```

Notes:

1. `latestStats` stores the newest parsed Docker stats payload.
2. `previousStats` allows CPU calculation to be based on two known samples even if the raw `precpu_stats` values are incomplete on the first message.
3. `syncState` is the UI-facing state source for warm-up and healthy steady-state rendering.
4. `starting` prevents duplicate stream creation when multiple sampler calls overlap.

### Stream Lifecycle

#### Creation

When `sampleDockerApi()` sees a running container:

1. if an active entry already has a live stream, do nothing
2. if the entry is already being created, do nothing
3. otherwise create a new entry or reuse the old one and start `container.stats({ stream: true })`

The sampler does not wait for the stream to warm before returning a snapshot. It only ensures that warm-up has been triggered.

#### First Message

On the first valid stats message:

1. parse and store the payload as `latestStats`
2. keep `syncState = 'syncing'`
3. allow memory usage to be rendered from this first sample
4. keep `cpuPercent = '0.00%'`
5. log that the container is in warm-up / syncing state

#### Second Valid Message and Beyond

On the second valid stats message and subsequent messages:

1. move the old `latestStats` to `previousStats`
2. store the new payload as `latestStats`
3. once two valid samples exist, set `syncState = 'ok'`
4. calculate CPU from the newest sample pair
5. keep refreshing `lastUpdateAt`

This matches measured behavior: first sample is enough for memory, but CPU percentage should not be trusted until a second sample is available.

#### Error and Close

On `error` or `close`:

1. log the event once with container name and short ID
2. null out the live `stream`
3. set `syncState = 'syncing'`
4. keep the latest cached stats as a temporary best-effort snapshot source
5. let the next `sampleDockerApi()` call recreate the stream

This avoids adding a separate background retry loop.

#### Container Removal

At the end of each `sampleDockerApi()` run:

1. compute the set of active container IDs returned by `listContainers()`
2. for every cached entry not in that set, destroy the stream and delete the entry
3. log the cleanup once

This keeps stream ownership aligned with the existing discovery flow.

## Sampling Semantics

### `sampleDockerApi()` Success Rules

The dispatcher should continue to treat `sampleDockerApi()` as successful as long as it can return a meaningful Docker snapshot.

Specifically:

1. containers in `syncing` state do not make the whole sampler fail
2. per-container stream warm-up does not trigger dispatcher fallback
3. per-container stream errors should degrade that container back to `syncing`, not fail the whole cycle
4. only true top-level failures should make the sampler throw, such as:
   - `listContainers()` failure
   - unrecoverable sampler-wide setup failure
   - no meaningful result can be produced at all

This preserves the existing primary/fallback boundary and avoids unnecessary CLI fallback during normal warm-up.

### Per-Container Output Rules

The sampler should return fields as follows.

#### No stats message has arrived yet

```ts
{
  syncState: 'syncing',
  cpuPercent: '0.00%',
  memUsage: '0B / 0B',
  memUsedRaw: 0,
  // base fields still come from listContainers() and inspect cache
}
```

#### First stats message has arrived

```ts
{
  syncState: 'syncing',
  cpuPercent: '0.00%',
  memUsage: '7.65GiB / 125.42GiB',
  memUsedRaw: 8214124953,
}
```

The exact memory values are whatever the first valid stream sample reports for that container.

#### Two or more valid stats messages have arrived

```ts
{
  syncState: 'ok',
  cpuPercent: '2.06%',
  memUsage: '7.65GiB / 125.42GiB',
  memUsedRaw: 8214124953,
}
```

The exact CPU and memory values continue to come from the most recent warm stream sample.

Fields still sourced from `listContainers()` should remain unchanged:

1. `id`
2. `name`
3. `image`
4. `status`
5. `ports`
6. `publishedPort`

GPU binding behavior should also remain unchanged and continue to use the existing inspect cache.

## Data Model Changes

### `ContainerMetrics`

Add one field to `lib/monitoring/contracts.ts`:

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

This is intentionally narrow. The design does not add nested status objects or timestamps to the public payload.

### Fallback CLI

`lib/monitoring/samplers/dockerCli.ts` should return:

```ts
syncState: 'ok'
```

for all containers.

Reasoning:

1. CLI fallback is a one-shot snapshot and has no warm-up stream phase
2. the fallback path should stay simple
3. the UI only needs a consistent field shape

## UI Integration

### Badge Behavior

`app/page.tsx` already renders a container status badge using `getContainerSyncState(lastSeenAt)`.

The UI should be updated with the smallest possible change:

1. if `runtime.syncState === 'syncing'`, force the badge to render `Syncing`
2. if `runtime.syncState === 'ok'`, render `OK` unless the existing freshness logic marks the card stale
3. keep the current `Stale` fallback based on `containerUpdatedAt` so long gaps in updates are still visible

This means the badge logic becomes a merge of:

1. backend warm-up state
2. existing frontend freshness / stale detection

Recommended precedence:

1. if freshness says `Stale`, show `Stale`
2. else if `runtime.syncState === 'syncing'`, show `Syncing`
3. else show `OK`

This preserves an already useful stale indicator while allowing the backend to explicitly control the warm-up phase.

### CPU and Memory Rendering

No additional UI branching is required for CPU and memory cards.

The backend owns the warm-up display behavior:

1. `syncing` containers already return `cpuPercent = '0.00%'`
2. first-sample memory values become visible as soon as they exist
3. `ok` containers continue to render real CPU and memory values

This keeps the page component simple.

## Logging

Console logging should exist only at state transitions, not on every stream event.

Recommended log points:

1. starting a stream
2. first valid stats received, container enters `syncing`
3. second valid stats received, container enters `ok`
4. stream error
5. stream close
6. stream cleanup on container removal
7. stream recreation after a previous close/error

Recommended non-goals for logging:

1. do not log every `data` event
2. do not log every sample cycle
3. do not log unchanged `syncing` or `ok` states repeatedly

## Verification Targets

After implementation, the following checks should demonstrate that the design works.

1. steady-state `sampleDockerApi()` latency should no longer be dominated by `stats({ stream: false })`
2. newly discovered containers should appear immediately with `syncState = 'syncing'`
3. while `syncing`, CPU should remain `0.00%`
4. memory usage should become visible as soon as the first stream sample arrives
5. after a second valid sample, containers should switch to `syncState = 'ok'`
6. if a stream closes, the container should fall back to `syncing` and recover on a later cycle without forcing dispatcher fallback

## Implementation Scope

The minimum implementation scope is:

1. `lib/monitoring/contracts.ts`
   - add `ContainerMetrics.syncState`
2. `lib/monitoring/samplers/dockerApi.ts`
   - add persistent stream cache and warm-up logic
   - replace one-shot stats reads with cached reads
3. `lib/monitoring/samplers/dockerCli.ts`
   - return `syncState: 'ok'`
4. `app/page.tsx`
   - drive the badge from `runtime.syncState` while preserving stale detection

No other architectural changes are required for the first version.

## Risks and Trade-Offs

1. The sampler becomes stateful instead of purely request-like.
2. Stream lifecycle code is more complex than one-shot stats calls.
3. First-sample warm-up still exists and must be represented honestly in the UI.
4. A later large-scale container-count scenario may require more advanced stream supervision, but that is outside this minimal refactor.

These trade-offs are acceptable because measured evidence shows that the current synchronous one-shot stats path is the dominant bottleneck and the stream cache directly targets that bottleneck without requiring broader dispatcher changes.
