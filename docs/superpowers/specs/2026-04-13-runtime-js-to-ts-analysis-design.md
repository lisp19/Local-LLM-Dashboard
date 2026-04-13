# Runtime JS to TS Analysis Design

## Goal

Analyze the Next.js project's runtime source code and identify business-code files that are still implemented in JavaScript rather than TypeScript, excluding build artifacts, scripts, deployment helpers, and configuration files. Produce:

- an index of remaining runtime `.js` or `.jsx` files
- a short responsibility summary for each file
- an assessment of whether each file can be refactored to TypeScript
- a prioritized shortlist of the best migration targets

## Scope

Included:

- runtime source code under application and library directories used by the running Next.js app
- server-side runtime modules that participate in request handling, monitoring, transport, or application behavior

Excluded:

- build artifacts such as `.next/`
- helper scripts under `scripts/`
- deployment or shell scripts
- docs and spec files
- configuration-only files such as `next.config.*`, `postcss.config.*`, and JSON config documents

## Output Format

The analysis output will contain:

1. a complete index of runtime `.js` and `.jsx` files
2. for each file:
   - path
   - role in the runtime
   - whether a same-purpose `.ts` or `.tsx` counterpart already exists
   - migration assessment category
3. a summary section with:
   - files that are likely migration leftovers
   - files that are good near-term TypeScript refactor candidates
   - files that can reasonably remain JavaScript for now

## Assessment Categories

Each runtime JavaScript file will be classified into one of these buckets:

- `Can migrate directly`: logic is already structured, interfaces are clear, and TypeScript conversion should be mostly mechanical
- `Can migrate with boundary work`: the file is a good candidate, but migration depends on resolving dynamic shapes, module-format issues, or missing type contracts at integration boundaries
- `Reasonable to keep short-term`: the file is runtime code, but the return on conversion is lower than other candidates, or it appears to be a transitional wrapper with limited business logic

## Method

1. locate runtime `.js` and `.jsx` files in source directories
2. filter out non-runtime and non-business-code files according to the agreed scope
3. inspect each remaining JavaScript file and its nearby TypeScript counterparts
4. determine whether the JavaScript file is:
   - the active implementation
   - a stale parallel copy of a TypeScript implementation
   - a runtime boundary module that still benefits from staying in JavaScript short-term
5. summarize refactorability and priority

## Prioritization Heuristic

Priority will favor files that:

- are clearly part of active runtime behavior
- have matching `.ts` equivalents or nearby type definitions that reduce migration cost
- expose shared contracts or data models where stronger types would improve correctness
- sit on important request, monitoring, or transport paths

Lower priority will be assigned to files that:

- are thin wrappers with little internal branching
- mainly bridge framework or environment behavior without much business logic
- already appear superseded by TypeScript versions and mainly need cleanup rather than refactor work

## Constraints and Assumptions

- The analysis is read-only and does not convert files in this pass.
- The project already allows JavaScript via `allowJs: true`, so the presence of runtime JavaScript is expected during migration.
- Some directories currently contain parallel `.js` and `.ts` files; these will be treated as likely migration artifacts unless inspection shows they serve different runtime roles.

## Success Criteria

The analysis is successful if it gives a complete runtime JavaScript index within the agreed scope and a practical TypeScript migration recommendation for each file, with clear reasoning about which files should be migrated first.
