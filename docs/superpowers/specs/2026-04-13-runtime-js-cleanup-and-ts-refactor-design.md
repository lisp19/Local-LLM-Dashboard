# Runtime JS Cleanup And TS Refactor Design

## Goal

Create a new branch from `dev`, keep the current worktree contents, remove runtime JavaScript files that are already replaceable by existing TypeScript source, migrate the remaining runtime-only JavaScript module to TypeScript, and finish with a clean `next build` and `eslint` run.

## Scope

Included:

- branch creation from `dev`
- runtime modules under `lib/` that are still checked in as `.js`
- import and module-boundary updates required to keep runtime behavior working after cleanup
- build and lint verification

Excluded:

- `.next/` and other build artifacts
- scripts, deployment files, and docs-only files
- unrelated refactors outside the runtime JS-to-TS migration path

## Current State

- The application starts from `server.ts` through `tsx`, so the main runtime is already TS-first.
- `lib/webshell-tokens.js` is the only remaining runtime business module without a TypeScript counterpart.
- Most `lib/**/*.js` files already have same-path `.ts` siblings and appear to be sidecar artifacts or migration residue.
- `app/api/webshell/auth/route.ts` still uses `require('../../../../lib/webshell-tokens')`, which is the main JS-specific import boundary that needs to be normalized.

## Target State

- A new branch based on `dev` contains the migration work.
- `lib/webshell-tokens.ts` exists and is used by both `server.ts` and `app/api/webshell/auth/route.ts`.
- Replaceable runtime `.js` sidecars under `lib/` are removed.
- Runtime imports resolve through the TypeScript source tree without requiring checked-in `.js` mirrors.
- `npm run build` and `npm run lint` both pass.

## Implementation Approach

1. create a new feature branch from `dev`, carrying the current worktree state forward
2. add a typed `lib/webshell-tokens.ts` implementation that preserves the existing token-store behavior
3. update the webshell auth route to use normal TypeScript imports instead of CommonJS `require`
4. delete runtime `.js` files in `lib/` that already have equivalent `.ts` siblings
5. run build and lint, then fix any import-resolution, module-interop, or lint issues caused by the cleanup

## Module Boundary Decisions

### Webshell Token Store

- Keep the current runtime behavior: one process-global token map with TTL-based issue, consume, and cleanup semantics.
- Replace the untyped `global[GLOBAL_KEY]` pattern with a typed `globalThis` extension or equivalent local helper.
- Export named functions with ES module syntax so TS callers can use normal imports.

### JS Sidecar Cleanup

- Delete only runtime `.js` files that have a same-purpose `.ts` sibling and no unique JS-only behavior.
- Prefer cleaning the duplicate source file rather than adding compatibility wrappers.
- If a deleted `.js` file exposes an import-resolution problem, fix the caller to resolve the TS module path rather than reintroducing the JS file.

## Risk Areas

- Some runtime paths may still rely on Node or bundler resolution behavior that previously found checked-in `.js` sidecars.
- The webshell token module currently mixes CommonJS and mutable global state, so its TS migration must preserve singleton behavior across imports.
- Lint may surface existing import-style issues once the JS files are removed.

## Verification

Required verification after implementation:

- `npm run build`
- `npm run lint`

Success means both commands exit cleanly without needing the deleted `lib/**/*.js` sidecars.

## Success Criteria

The work is successful if:

- the new branch is based on `dev`
- replaceable runtime JS sidecars are removed
- `lib/webshell-tokens.js` is replaced by a TS implementation
- the app builds successfully
- lint reports no errors
