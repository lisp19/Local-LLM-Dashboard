# Design Spec - Non-linear Memory Progress Bar Mapping

## 1. Goal
Improve the visual representation of Docker container memory usage by implementing a non-linear mapping that balances relative differences, system-wide context, and visibility for low-usage containers.

## 2. Mathematical Model

### 2.1 Inputs
- `used`: Memory bytes used by the container.
- `maxUsed`: The maximum memory bytes used among all running containers.
- `totalMem`: Total system memory bytes.
- `memCeiling`: `max(maxUsed, 8GB)` (Normalization base).

### 2.2 Ratios
- **Relative Ratio ($r_{rel}$)**: `used / memCeiling` (0.0 to 1.0).
- **System Ratio ($r_{sys}$)**: `used / totalMem` (0.0 to 1.0).

### 2.3 Normalized Sigmoid ($\hat{\sigma}(x)$)
To provide an S-curve that maps $[0, 1] \to [0, 1]$:
$$ \sigma(x) = \frac{1}{1 + e^{-10(x-0.5)}} $$
$$ \hat{\sigma}(x) = \frac{\sigma(x) - \sigma(0)}{\sigma(1) - \sigma(0)} $$

### 2.4 Visual Width ($W$)
The final progress bar percentage is calculated based on $r_{sys}$ thresholds:

- **Normal Mode ($r_{sys} \le 0.5$):**
  $$ W_{pre} = (0.05 + 0.90 \times \hat{\sigma}(r_{rel})) \times 100 $$
  $$ L(r_{sys}) = 0.3 \cdot (2r_{sys}) + 0.7 \cdot \frac{\ln(1 + 9 \cdot (2r_{sys}))}{\ln(10)} $$
  $$ W = W_{pre} \cdot L(r_{sys}) $$
  - Floor: 5% (Visibility).
  - Ceiling: Controlled by $L(r_{sys})$, will be significantly less than 95% when usage is low.

- **Warning Mode ($r_{sys} > 0.5$):**
  $$ W = (0.15 + 0.85 \times \hat{\sigma}(r_{rel})) \times 100 $$
  - Floor: 15% (Visual jump for warning).
  - Ceiling: 100% (Full alert).
  - Color: Red/Orange.

## 3. Implementation Plan

### 3.1 Backend
- Ensure `lib/systemMetrics.ts` provides `memUsedRaw` and `system.memory.total`. (Already implemented).

### 3.2 Frontend (`app/page.tsx`)
1. Implement `calculateVisualWidth` helper function.
2. Update the `Progress` component in the container list:
   - Use `calculateVisualWidth` for the `percent` prop.
   - Dynamically set `strokeColor` based on $r_{sys} > 0.5$.

## 4. Verification
- Verify that small containers (e.g., < 100MB) have a visible bar (~5%).
- Verify that the largest container is not always at 100% unless it's in Warning Mode.
- Verify monotonicity during the transition at $r_{sys} = 0.5$.
