# Memory UI Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a non-linear Sigmoid-based mapping for the memory progress bar with threshold-based warning modes.

**Architecture:** Add a helper function in the frontend to calculate visual width based on relative and system-wide memory ratios, then update the UI component to use this width and dynamic coloring.

**Tech Stack:** React, Ant Design, TypeScript.

---

### Task 1: Implementation of Mapping Logic

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Define the mapping helper function**

Add this function inside the `DashboardPage` component or as a top-level utility in `app/page.tsx`:

```typescript
const calculateVisualWidth = (usedRaw: number, memCeiling: number, totalMem: number) => {
  if (!usedRaw || !memCeiling || !totalMem) return 0;

  const rRel = usedRaw / memCeiling;
  const rSys = usedRaw / totalMem;

  // Normalized Sigmoid: maps [0, 1] to [0, 1] with S-curve
  const k = 10;
  const sigma = (x: number) => 1 / (1 + Math.exp(-k * (x - 0.5)));
  const sigma0 = sigma(0);
  const sigma1 = sigma(1);
  const hatSigma = (x: number) => (sigma(x) - sigma0) / (sigma1 - sigma0);

  const s = hatSigma(rRel);

  if (rSys <= 0.5) {
    // Normal Mode: 5% floor, 95% ceiling
    return (0.05 + 0.90 * s) * 100;
  } else {
    // Warning Mode: 15% floor, 100% ceiling
    return (0.15 + 0.85 * s) * 100;
  }
};
```

- [ ] **Step 2: Update the rendering logic to use the helper**

Modify the container loop in `app/page.tsx` to calculate the width and determine the color.

```tsx
// Inside sortedContainers.map
const isPinned = pinnedNames.has(runtime.name) || modelConfig?.Pinned === true;
const totalSystemMem = data?.system.memory.total || 1;
const visualWidth = calculateVisualWidth(runtime.memUsedRaw, memCeiling, totalSystemMem);
const isWarning = (runtime.memUsedRaw / totalSystemMem) > 0.5;
```

- [ ] **Step 3: Update the Progress component**

```tsx
<div>
  <div className="flex justify-between text-xs mb-1 font-medium">
    <span className="text-slate-500">MEM ({runtime.memUsage})</span>
  </div>
  <Progress 
    percent={visualWidth} 
    showInfo={false} 
    size="small" 
    strokeColor={isWarning ? "#ff4d4f" : "#52c41a"} 
    trailColor="#e2e8f0" 
    status={isWarning ? "exception" : "active"} 
  />
</div>
```

- [ ] **Step 4: Verify and Commit**

```bash
git add app/page.tsx
git commit -m "feat(ui): implement non-linear sigmoid mapping for memory progress bar"
```
