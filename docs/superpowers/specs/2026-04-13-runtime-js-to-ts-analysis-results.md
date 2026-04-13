# Runtime JS to TS Analysis Results

## Scope Used

This analysis only counts runtime source files that participate in the running Next.js application.

Included:

- runtime modules under `lib/` that back server, API, monitoring, or webshell behavior

Excluded:

- build output such as `.next/`
- helper scripts under `scripts/`
- deployment shell scripts and docs
- configuration files such as `next.config.mjs`, `postcss.config.mjs`, and JSON config documents
- root-level generated or transitional outputs such as `server.js` and `server.bundle.js`

Context used for the classification:

- `package.json` starts the app with `tsx server.ts`, so the typed server entrypoint is the active source path in normal dev and start flows
- `tsconfig.json` has `allowJs: true`, which explains why checked-in JavaScript sidecars can coexist with TypeScript source during migration
- most runtime `.js` files in `lib/` already have same-path `.ts` siblings, which strongly suggests a partial migration with checked-in sidecar output

## Runtime JS File Index

There are `24` runtime `.js` files in scope.

1. `lib/appConfig.js`
2. `lib/config/loadConfig.js`
3. `lib/config/types.js`
4. `lib/monitoring/bus.js`
5. `lib/monitoring/contracts.js`
6. `lib/monitoring/runtime.js`
7. `lib/monitoring/topics.js`
8. `lib/monitoring/transport/agentAuth.js`
9. `lib/monitoring/projectors/coreProjector.js`
10. `lib/monitoring/projectors/healthProjector.js`
11. `lib/monitoring/dispatchers/createDispatcher.js`
12. `lib/monitoring/dispatchers/dockerDispatcher.js`
13. `lib/monitoring/dispatchers/gpuDispatcher.js`
14. `lib/monitoring/dispatchers/modelConfigDispatcher.js`
15. `lib/monitoring/dispatchers/systemDispatcher.js`
16. `lib/monitoring/samplers/dockerApi.js`
17. `lib/monitoring/samplers/dockerCli.js`
18. `lib/monitoring/samplers/gpuFallback.js`
19. `lib/monitoring/samplers/gpuPrimary.js`
20. `lib/monitoring/samplers/modelConfigFallback.js`
21. `lib/monitoring/samplers/modelConfigPrimary.js`
22. `lib/monitoring/samplers/systemFallback.js`
23. `lib/monitoring/samplers/systemPrimary.js`
24. `lib/webshell-tokens.js`

Of these `24` files:

- `23` already have same-path `.ts` siblings
- `1` is still JS-only: `lib/webshell-tokens.js`

## Per-File Assessment

### Config And Alias Modules

- `lib/appConfig.js`
  Role: thin runtime re-export from `./config/loadConfig`.
  Counterpart: sibling TS implementation exists at `lib/appConfig.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: no real rewrite is needed; prefer deleting the JS sidecar after confirming no JS-only consumer still depends on it.

- `lib/config/loadConfig.js`
  Role: Node-side loader for `config.json` and `model-config.json` with deep-merge defaults.
  Counterpart: sibling TS implementation exists at `lib/config/loadConfig.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: treat the TS file as the source of truth and clean up the JS sidecar once import and runtime paths are consolidated.

- `lib/config/types.js`
  Role: no meaningful runtime role; effectively an emitted placeholder for type definitions.
  Counterpart: sibling TS implementation exists at `lib/config/types.ts`.
  Migration category: `Reasonable to keep short-term`.
  Recommendation: this is cleanup residue, not a migration target; remove it after validating there is no JS path that still expects the stub module.

### Monitoring Core Modules

- `lib/monitoring/bus.js`
  Role: in-memory monitoring message bus.
  Counterpart: sibling TS implementation exists at `lib/monitoring/bus.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: the TS implementation already carries the current queue-stat shape, so this JS file looks like stale sidecar output and should be cleaned up rather than rewritten.

- `lib/monitoring/contracts.js`
  Role: no-op runtime stub for the monitoring type contract file.
  Counterpart: sibling TS implementation exists at `lib/monitoring/contracts.ts`.
  Migration category: `Reasonable to keep short-term`.
  Recommendation: there is nothing substantive to migrate here; remove it as part of JS sidecar cleanup.

- `lib/monitoring/runtime.js`
  Role: monitoring runtime bootstrap and singleton orchestration.
  Counterpart: sibling TS implementation exists at `lib/monitoring/runtime.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: `server.ts` and TS API routes already target the typed runtime path, so this JS file is best treated as migration residue.

- `lib/monitoring/topics.js`
  Role: constants for monitoring topics and subscription groups.
  Counterpart: sibling TS implementation exists at `lib/monitoring/topics.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: the TS constants are already equivalent, so future work here is cleanup, not refactoring.

- `lib/monitoring/transport/agentAuth.js`
  Role: agent token validation for HTTP and socket reporting.
  Counterpart: sibling TS implementation exists at `lib/monitoring/transport/agentAuth.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: the TS version is already the stronger implementation; keep only one source once runtime cleanup is scheduled.

- `lib/monitoring/projectors/coreProjector.js`
  Role: projector that assembles the dashboard snapshot from monitoring events.
  Counterpart: sibling TS implementation exists at `lib/monitoring/projectors/coreProjector.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: this appears to be a direct sidecar mirror of the TS projector and is a cleanup candidate.

- `lib/monitoring/projectors/healthProjector.js`
  Role: projector that assembles dispatcher, queue, and agent health state.
  Counterpart: sibling TS implementation exists at `lib/monitoring/projectors/healthProjector.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: the TS file already matches the current queue contract, while this JS file still reflects older queue stats, so cleanup should take priority over further JS work.

### Monitoring Dispatcher Modules

- `lib/monitoring/dispatchers/createDispatcher.js`
  Role: shared polling, fallback, degrade, and recovery engine used by all monitoring dispatchers.
  Counterpart: sibling TS implementation exists at `lib/monitoring/dispatchers/createDispatcher.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: the TypeScript implementation already exists and matches the runtime behavior, so the practical next step is import-path and artifact cleanup, not a fresh rewrite.

- `lib/monitoring/dispatchers/dockerDispatcher.js`
  Role: thin runtime wiring for Docker primary and fallback samplers.
  Counterpart: sibling TS implementation exists at `lib/monitoring/dispatchers/dockerDispatcher.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: this is already effectively migrated; remove the JS sidecar when the remaining JS runtime chain is retired.

- `lib/monitoring/dispatchers/gpuDispatcher.js`
  Role: thin runtime wiring for GPU primary and fallback samplers.
  Counterpart: sibling TS implementation exists at `lib/monitoring/dispatchers/gpuDispatcher.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: this is composition code with a matching TS source, so cleanup is higher value than refactor work.

- `lib/monitoring/dispatchers/modelConfigDispatcher.js`
  Role: dispatcher for model-config sampling and fallback-cache refresh.
  Counterpart: sibling TS implementation exists at `lib/monitoring/dispatchers/modelConfigDispatcher.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: the TS version already covers this behavior, making the JS file a cleanup target.

- `lib/monitoring/dispatchers/systemDispatcher.js`
  Role: thin runtime wiring for system metric sampling.
  Counterpart: sibling TS implementation exists at `lib/monitoring/dispatchers/systemDispatcher.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: this is a low-risk sidecar cleanup candidate once the runtime no longer needs checked-in JS mirrors.

### Monitoring Sampler Modules

- `lib/monitoring/samplers/dockerApi.js`
  Role: primary Docker sampler using `dockerode` to collect live container metrics.
  Counterpart: sibling TS implementation exists at `lib/monitoring/samplers/dockerApi.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: the TS implementation is already present; future work should validate consumers and remove the JS sidecar instead of refactoring logic again.

- `lib/monitoring/samplers/dockerCli.js`
  Role: fallback Docker sampler using Docker CLI commands.
  Counterpart: sibling TS implementation exists at `lib/monitoring/samplers/dockerCli.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: this is already represented in TS, so the remaining task is cleanup plus runtime validation.

- `lib/monitoring/samplers/gpuFallback.js`
  Role: fallback GPU sampler for degraded host environments.
  Counterpart: sibling TS implementation exists at `lib/monitoring/samplers/gpuFallback.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: the TS source already exists; the JS file should be retired together with the rest of the sidecar sampler set.

- `lib/monitoring/samplers/gpuPrimary.js`
  Role: primary GPU sampler using host GPU tooling.
  Counterpart: sibling TS implementation exists at `lib/monitoring/samplers/gpuPrimary.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: the typed implementation already captures the current logic, so this should be treated as cleanup residue.

- `lib/monitoring/samplers/modelConfigFallback.js`
  Role: in-memory fallback cache for model-config data.
  Counterpart: sibling TS implementation exists at `lib/monitoring/samplers/modelConfigFallback.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: the TS file mirrors the behavior closely, so the JS sidecar is removable once the runtime chain is consolidated.

- `lib/monitoring/samplers/modelConfigPrimary.js`
  Role: primary model-config sampler delegating to `loadModelConfig()`.
  Counterpart: sibling TS implementation exists at `lib/monitoring/samplers/modelConfigPrimary.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: this is already effectively migrated; no additional refactor value remains in the JS file.

- `lib/monitoring/samplers/systemFallback.js`
  Role: fallback system sampler that reads low-level host data.
  Counterpart: sibling TS implementation exists at `lib/monitoring/samplers/systemFallback.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: the TS implementation already exists, so the next step is cleanup and validation, not a new conversion.

- `lib/monitoring/samplers/systemPrimary.js`
  Role: primary system sampler for CPU, memory, and host metadata.
  Counterpart: sibling TS implementation exists at `lib/monitoring/samplers/systemPrimary.ts`.
  Migration category: `Can migrate directly`.
  Recommendation: this is already present in TS, making the JS file a sidecar-cleanup candidate.

### Webshell Module

- `lib/webshell-tokens.js`
  Role: process-global in-memory token store for the webshell auth flow.
  Counterpart: none.
  Migration category: `Can migrate with boundary work`.
  Recommendation: this is the only real remaining JS-only runtime module; migrate it to TypeScript after replacing the CommonJS export shape and adding a typed `globalThis` store contract for the shared token map.

## Priority Migration Targets

1. `lib/webshell-tokens.js`
   Why first: this is the only runtime JS file without a TS sibling, and it is directly used by both `server.ts` and `app/api/webshell/auth/route.ts`.

2. No second-tier refactor target stands out.
   Why: every other runtime JS file already has a same-path TS implementation, so the project's next move after `lib/webshell-tokens.js` is cleanup rather than additional conversion.

## Cleanup Instead Of Refactor

These files already have TS twins and are better treated as JS-sidecar cleanup work than as new TS migration tasks:

- `lib/appConfig.js`
- `lib/config/loadConfig.js`
- `lib/config/types.js`
- `lib/monitoring/bus.js`
- `lib/monitoring/contracts.js`
- `lib/monitoring/runtime.js`
- `lib/monitoring/topics.js`
- `lib/monitoring/transport/agentAuth.js`
- `lib/monitoring/projectors/coreProjector.js`
- `lib/monitoring/projectors/healthProjector.js`
- `lib/monitoring/dispatchers/createDispatcher.js`
- `lib/monitoring/dispatchers/dockerDispatcher.js`
- `lib/monitoring/dispatchers/gpuDispatcher.js`
- `lib/monitoring/dispatchers/modelConfigDispatcher.js`
- `lib/monitoring/dispatchers/systemDispatcher.js`
- `lib/monitoring/samplers/dockerApi.js`
- `lib/monitoring/samplers/dockerCli.js`
- `lib/monitoring/samplers/gpuFallback.js`
- `lib/monitoring/samplers/gpuPrimary.js`
- `lib/monitoring/samplers/modelConfigFallback.js`
- `lib/monitoring/samplers/modelConfigPrimary.js`
- `lib/monitoring/samplers/systemFallback.js`
- `lib/monitoring/samplers/systemPrimary.js`

Notable cleanup signals:

- `lib/monitoring/contracts.js` and `lib/config/types.js` are effectively empty stubs
- `lib/monitoring/projectors/healthProjector.js` still reflects older queue stats than `lib/monitoring/projectors/healthProjector.ts`, which is a strong sign that the JS file is not the intended source of truth anymore
- `package.json` and `server.ts` indicate the normal runtime path is already TS-first

## Overall Recommendation

The remaining runtime JS is mostly not “untyped business logic that still needs to be ported.” It is primarily a checked-in sidecar layer from an in-progress or already-completed TS migration.

The practical picture is:

- truly active JS-only runtime logic: `1` file, `lib/webshell-tokens.js`
- runtime JS files that already have TS siblings: `23` files
- files that look more like cleanup residue than future migration work: effectively all of those `23` sibling pairs

Recommended next move:

1. migrate `lib/webshell-tokens.js` to TypeScript
2. then do a focused cleanup pass for the `lib/**/*.js` sidecars that duplicate active TS modules
3. validate startup and API routes after cleanup, because the remaining risk is import-resolution or leftover JS runtime entrypoints rather than missing TypeScript implementations
