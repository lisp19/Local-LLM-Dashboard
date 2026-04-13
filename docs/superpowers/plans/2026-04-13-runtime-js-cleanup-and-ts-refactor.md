# Runtime JS Cleanup And TS Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the runtime codebase onto TypeScript-only source modules by migrating the remaining JS-only runtime file, deleting replaceable JS sidecars, and finishing with a clean build and lint run on a new branch from `dev`.

**Architecture:** The implementation keeps the existing TS-first runtime entrypoints and removes duplicated JS sidecars under `lib/`. The only real source migration is `lib/webshell-tokens.js` to `lib/webshell-tokens.ts`, after which runtime imports should resolve entirely through TypeScript sources.

**Tech Stack:** Git, Next.js 15, TypeScript 5, tsx, ESLint 9, Node.js runtime modules

---

## File Map

- Modify: `app/api/webshell/auth/route.ts` - replace CommonJS token-store import with TS import
- Modify: `server.ts` - keep importing the token-store module after TS migration
- Create: `lib/webshell-tokens.ts` - typed runtime token-store singleton
- Delete: `lib/webshell-tokens.js` - replaced by TS implementation
- Delete: `lib/appConfig.js`
- Delete: `lib/config/loadConfig.js`
- Delete: `lib/config/types.js`
- Delete: `lib/monitoring/bus.js`
- Delete: `lib/monitoring/contracts.js`
- Delete: `lib/monitoring/runtime.js`
- Delete: `lib/monitoring/topics.js`
- Delete: `lib/monitoring/transport/agentAuth.js`
- Delete: `lib/monitoring/projectors/coreProjector.js`
- Delete: `lib/monitoring/projectors/healthProjector.js`
- Delete: `lib/monitoring/dispatchers/createDispatcher.js`
- Delete: `lib/monitoring/dispatchers/dockerDispatcher.js`
- Delete: `lib/monitoring/dispatchers/gpuDispatcher.js`
- Delete: `lib/monitoring/dispatchers/modelConfigDispatcher.js`
- Delete: `lib/monitoring/dispatchers/systemDispatcher.js`
- Delete: `lib/monitoring/samplers/dockerApi.js`
- Delete: `lib/monitoring/samplers/dockerCli.js`
- Delete: `lib/monitoring/samplers/gpuFallback.js`
- Delete: `lib/monitoring/samplers/gpuPrimary.js`
- Delete: `lib/monitoring/samplers/modelConfigFallback.js`
- Delete: `lib/monitoring/samplers/modelConfigPrimary.js`
- Delete: `lib/monitoring/samplers/systemFallback.js`
- Delete: `lib/monitoring/samplers/systemPrimary.js`

### Task 1: Create The Feature Branch From Dev

**Files:**
- Read: `git status`
- Read: `git branch`

- [ ] **Step 1: Confirm the current worktree state before branching**

Run: `git status --short --branch`
Expected: current branch is not `dev`, and the untracked `docs/superpowers/...` files are visible and intentionally preserved.

- [ ] **Step 2: Create a new branch from `dev` while carrying the current worktree forward**

Run: `git switch -c feat/runtime-js-cleanup-and-ts-refactor dev`
Expected: Git reports a new branch based on `dev` and keeps the existing working tree changes in place.

- [ ] **Step 3: Confirm the new branch is checked out**

Run: `git status --short --branch`
Expected: branch header shows `feat/runtime-js-cleanup-and-ts-refactor`.

### Task 2: Migrate The Webshell Token Store To TypeScript

**Files:**
- Create: `lib/webshell-tokens.ts`
- Modify: `app/api/webshell/auth/route.ts`
- Delete: `lib/webshell-tokens.js`

- [ ] **Step 1: Add the typed token-store implementation**

Create `lib/webshell-tokens.ts` with this shape:

```ts
const GLOBAL_KEY = '__WEBSHELL_TOKENS__';
const TOKEN_TTL_MS = 5 * 60 * 1000;

type TokenStore = Map<string, number>;

declare global {
  // eslint-disable-next-line no-var
  var __WEBSHELL_TOKENS__: TokenStore | undefined;
}

function getTokenStore(): TokenStore {
  if (!globalThis[GLOBAL_KEY as keyof typeof globalThis]) {
    globalThis.__WEBSHELL_TOKENS__ = new Map<string, number>();
  }

  return globalThis.__WEBSHELL_TOKENS__;
}

export function issueToken(token: string, ttl = TOKEN_TTL_MS): void {
  getTokenStore().set(token, Date.now() + ttl);
}

export function consumeToken(token: string): boolean {
  const validTokens = getTokenStore();
  const expiry = validTokens.get(token);
  if (!expiry) return false;

  if (Date.now() > expiry) {
    validTokens.delete(token);
    return false;
  }

  validTokens.delete(token);
  return true;
}

export function cleanupExpired(): void {
  const validTokens = getTokenStore();
  const now = Date.now();

  for (const [token, expiry] of validTokens.entries()) {
    if (now > expiry) {
      validTokens.delete(token);
    }
  }
}
```

- [ ] **Step 2: Replace the auth route's CommonJS import**

Update `app/api/webshell/auth/route.ts` so the top of the file becomes:

```ts
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { cleanupExpired, issueToken } from '../../../../lib/webshell-tokens';
```

Expected result: the `require('../../../../lib/webshell-tokens')` line and its eslint suppression are removed.

- [ ] **Step 3: Remove the old JavaScript token-store file**

Delete: `lib/webshell-tokens.js`

- [ ] **Step 4: Sanity check token-store call sites**

Read `server.ts` and `app/api/webshell/auth/route.ts` and verify both now resolve `lib/webshell-tokens` through TypeScript source.

### Task 3: Remove Replaceable Runtime JS Sidecars

**Files:**
- Delete all replaceable `lib/**/*.js` sidecars listed in the File Map

- [ ] **Step 1: Delete config and alias sidecars**

Delete these files:

```text
lib/appConfig.js
lib/config/loadConfig.js
lib/config/types.js
```

- [ ] **Step 2: Delete monitoring core sidecars**

Delete these files:

```text
lib/monitoring/bus.js
lib/monitoring/contracts.js
lib/monitoring/runtime.js
lib/monitoring/topics.js
lib/monitoring/transport/agentAuth.js
lib/monitoring/projectors/coreProjector.js
lib/monitoring/projectors/healthProjector.js
```

- [ ] **Step 3: Delete dispatcher and sampler sidecars**

Delete these files:

```text
lib/monitoring/dispatchers/createDispatcher.js
lib/monitoring/dispatchers/dockerDispatcher.js
lib/monitoring/dispatchers/gpuDispatcher.js
lib/monitoring/dispatchers/modelConfigDispatcher.js
lib/monitoring/dispatchers/systemDispatcher.js
lib/monitoring/samplers/dockerApi.js
lib/monitoring/samplers/dockerCli.js
lib/monitoring/samplers/gpuFallback.js
lib/monitoring/samplers/gpuPrimary.js
lib/monitoring/samplers/modelConfigFallback.js
lib/monitoring/samplers/modelConfigPrimary.js
lib/monitoring/samplers/systemFallback.js
lib/monitoring/samplers/systemPrimary.js
```

- [ ] **Step 4: Confirm no replaceable runtime JS sidecars remain**

Run: `git status --short`
Expected: the deleted `lib/**/*.js` files appear as removals, and `lib/webshell-tokens.ts` appears as a new file.

### Task 4: Fix Any Import Or Module Boundary Issues

**Files:**
- Modify any runtime TS file that still assumes the deleted sidecars exist

- [ ] **Step 1: Search for JS-specific runtime imports or requires**

Search the codebase for direct `.js` imports and CommonJS `require()` calls that target the deleted runtime modules.

Expected focus areas:

```text
app/api/webshell/auth/route.ts
server.ts
app/api/**/route.ts
lib/**/*.ts
```

- [ ] **Step 2: Normalize any broken imports to TS-source module paths**

If any runtime file still points at a deleted JS sidecar, switch it to the extensionless TS module path rather than recreating the JS file.

- [ ] **Step 3: Re-read changed runtime entrypoints for consistency**

Read the final versions of:

```text
server.ts
app/api/webshell/auth/route.ts
lib/webshell-tokens.ts
```

Expected: import style is consistent and there are no remaining JS-only runtime boundaries for the token store.

### Task 5: Verify Build And Lint

**Files:**
- Read-only verification against the modified codebase

- [ ] **Step 1: Run the production build**

Run: `npm run build`
Expected: Next.js build completes successfully without module-resolution errors.

- [ ] **Step 2: Run the linter**

Run: `npm run lint`
Expected: ESLint finishes with no errors.

- [ ] **Step 3: If verification fails, fix the concrete issue and rerun the failing command**

Allowed fixes include:

```text
- import cleanup
- TypeScript typing fixes
- lint-compliant reordering or syntax fixes
- module boundary adjustments caused by sidecar deletion
```

Do not reintroduce deleted JS sidecars unless a unique runtime need is proven.

### Task 6: Summarize The Final State

**Files:**
- Read: `git status --short --branch`

- [ ] **Step 1: Capture the final branch and worktree state**

Run: `git status --short --branch`
Expected: branch is `feat/runtime-js-cleanup-and-ts-refactor`, modified files reflect the TS migration and JS cleanup, and no unexpected runtime JS sidecars remain.

- [ ] **Step 2: Report the exact migration outcome**

The final summary must state:

```text
- the new branch name
- that `lib/webshell-tokens.js` was replaced by `lib/webshell-tokens.ts`
- that replaceable runtime `lib/**/*.js` sidecars were removed
- the exact results of `npm run build` and `npm run lint`
```
