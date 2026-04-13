# Runtime JS to TS Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete inventory of runtime JavaScript files in the Next.js app, excluding non-runtime files, and assess which ones should be migrated to TypeScript.

**Architecture:** The work is a read-only codebase analysis. First identify the runtime JavaScript candidate set, then inspect each file alongside any TypeScript counterpart, and finally synthesize the findings into a categorized report with migration recommendations and priorities.

**Tech Stack:** Next.js 15, TypeScript 5, Node.js runtime modules, OpenCode file search/read tools

---

## File Map

- Read: `README.md` - confirms runtime architecture and active monitoring modules
- Read: `tsconfig.json` - confirms `allowJs` and current TypeScript boundary behavior
- Read: `server.ts` - confirms the active typed server entrypoint and helps identify `server.js` as emitted output rather than business source
- Read: `lib/**/*.js` - candidate runtime JavaScript files under active library code
- Read: `lib/**/*.ts` - TypeScript counterparts for migration comparison
- Create: `docs/superpowers/specs/2026-04-13-runtime-js-to-ts-analysis-results.md` - final analysis report containing index and migration assessment

### Task 1: Build The Candidate Runtime JS Index

**Files:**
- Read: `README.md`
- Read: `tsconfig.json`
- Read: `server.ts`
- Read: `lib/**/*.js`

- [ ] **Step 1: List all JavaScript files in the repository**

Run: `rg --files -g '*.js' -g '*.jsx'`
Expected: a raw list that includes runtime source files plus excluded files such as build output or generated bundles.

- [ ] **Step 2: Filter the raw list to the agreed runtime scope**

Keep only files that are part of runtime business logic. Exclude entries under `.next/`, `scripts/`, docs paths, deployment helpers, configuration files, and generated bundles such as `server.bundle.js`.

The expected candidate set should center on:

```text
lib/appConfig.js
lib/config/loadConfig.js
lib/config/types.js
lib/monitoring/bus.js
lib/monitoring/contracts.js
lib/monitoring/runtime.js
lib/monitoring/topics.js
lib/monitoring/transport/agentAuth.js
lib/monitoring/projectors/coreProjector.js
lib/monitoring/projectors/healthProjector.js
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
lib/webshell-tokens.js
```

- [ ] **Step 3: Confirm which root-level JavaScript files are generated rather than source**

Read `server.ts` and `server.js` side by side. If `server.js` is a downleveled mirror of `server.ts`, mark it as generated or transitional output and exclude it from the runtime business-code inventory.

- [ ] **Step 4: Record the final candidate index in the results document**

Create the `Runtime JS File Index` section in `docs/superpowers/specs/2026-04-13-runtime-js-to-ts-analysis-results.md` and paste the final candidate list as a flat path index.

### Task 2: Determine Whether Each JS File Is Active, Transitional, Or Already Replaced

**Files:**
- Read: `lib/**/*.js`
- Read: `lib/**/*.ts`
- Modify: `docs/superpowers/specs/2026-04-13-runtime-js-to-ts-analysis-results.md`

- [ ] **Step 1: Group each JavaScript file with its same-name TypeScript counterpart when present**

For every file under `lib/**/*.js`, check whether a sibling `*.ts` file exists at the same logical path. Record one of these statuses for each JavaScript file:

```text
- JS only
- JS + TS sibling present
- JS appears to be emitted output of TS source
```

- [ ] **Step 2: Inspect small wrapper modules first**

Start with tiny modules such as `lib/appConfig.js` and `lib/webshell-tokens.js`. Determine whether they are:

```text
- a live runtime module still used by imports
- a bridge that can be ported with minimal effort
- a special-case CommonJS or runtime shim that may need boundary work
```

- [ ] **Step 3: Inspect the monitoring modules in path clusters**

Review these groups together so that status decisions are consistent:

```text
lib/monitoring/bus.*
lib/monitoring/contracts.*
lib/monitoring/runtime.*
lib/monitoring/topics.*
lib/monitoring/transport/agentAuth.*
lib/monitoring/projectors/*
lib/monitoring/dispatchers/*
lib/monitoring/samplers/*
lib/config/*
```

For each group, identify whether the JavaScript file is still the active implementation or simply a stale parallel copy of the TypeScript file.

- [ ] **Step 4: Capture counterpart status in the results document**

For every indexed file, add a short row or bullet noting its responsibility and one of:

```text
Counterpart: none
Counterpart: sibling TS implementation exists
Counterpart: generated mirror of TS implementation
```

### Task 3: Classify TypeScript Refactorability

**Files:**
- Read: `lib/**/*.js`
- Read: `lib/**/*.ts`
- Modify: `docs/superpowers/specs/2026-04-13-runtime-js-to-ts-analysis-results.md`

- [ ] **Step 1: Apply the migration rubric to each file**

Use exactly these categories in the results document:

```text
- Can migrate directly
- Can migrate with boundary work
- Reasonable to keep short-term
```

Use `Can migrate directly` when the file is a simple wrapper, alias, or a near one-to-one copy of an existing TypeScript implementation.

Use `Can migrate with boundary work` when the file is runtime-critical but mixes dynamic objects, CommonJS exports, framework boundaries, or third-party API surfaces that need care.

Use `Reasonable to keep short-term` when the file has limited business value, appears superseded by TypeScript already, or would be better removed than migrated.

- [ ] **Step 2: Note the concrete reason for each classification**

For every file, add a one-sentence reason anchored in what the file does. Good reasons include:

```text
- sibling TS file already exists, suggesting JS is migration residue
- CommonJS export shape still feeds a server/runtime boundary
- dynamic JSON or external process output weakens immediate type safety
- file is a thin alias and conversion is mechanical
```

- [ ] **Step 3: Identify the highest-value migration targets**

Create a `Priority Migration Targets` section and rank the best candidates by practical value. Favor modules that sit on shared runtime contracts, monitoring transport, or central dispatcher paths, but only when TypeScript conversion looks low-risk.

- [ ] **Step 4: Identify files better treated as cleanup rather than conversion**

Create a `Cleanup Instead Of Refactor` section for files whose main issue is duplicated JS beside active TS, where deletion or import-path cleanup may be more appropriate than a dedicated rewrite.

### Task 4: Write The Final Analysis Report

**Files:**
- Modify: `docs/superpowers/specs/2026-04-13-runtime-js-to-ts-analysis-results.md`

- [ ] **Step 1: Structure the report with these sections**

Write the document using exactly this outline:

```markdown
# Runtime JS to TS Analysis Results

## Scope Used
## Runtime JS File Index
## Per-File Assessment
## Priority Migration Targets
## Cleanup Instead Of Refactor
## Overall Recommendation
```

- [ ] **Step 2: Fill in the per-file assessment with concise, file-specific statements**

Each file entry should include:

```text
- path
- runtime role
- counterpart status
- migration category
- short recommendation
```

- [ ] **Step 3: Write the overall recommendation as an action-oriented summary**

The closing section should answer these points directly:

```text
- how much runtime JS is truly still active
- how much is duplicate residue from a TS migration already in progress
- whether the next move should be refactor, cleanup, or both
```

- [ ] **Step 4: Sanity check completeness against the candidate index**

Verify that every file in `Runtime JS File Index` has exactly one assessment entry and one migration category. If any file is missing, add it before finalizing the report.

### Task 5: Present The Findings To The User

**Files:**
- Read: `docs/superpowers/specs/2026-04-13-runtime-js-to-ts-analysis-results.md`

- [ ] **Step 1: Summarize the counts and strongest conclusions**

Prepare a concise user-facing summary that states:

```text
- how many runtime JS files remain
- how many have TS siblings
- which files are the best migration candidates
- which files appear to be removable migration leftovers
```

- [ ] **Step 2: Include direct file references in the response**

Reference paths exactly as they appear in the report so the user can jump straight into the code.

- [ ] **Step 3: Avoid claiming conversion work was done**

This task is analysis only. The final response should clearly separate inventory and recommendations from any future refactor work.
