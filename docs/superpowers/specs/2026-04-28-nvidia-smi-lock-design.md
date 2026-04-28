# Nvidia-SMI Global Lock Design

## 1. 目标
防止系统中出现多个并行的 `nvidia-smi` 进程，导致系统资源（CPU/内存）被大量占用。

## 2. 核心机制设计

为了同时满足“同一时间只有一个 nvidia-smi 运行”以及“并发请求共享结果”，我们将设计一个统一的调度器：

### 2.1 请求去重 (Promise Deduplication)
* 针对相同类型的请求（如都是 `primary` 采样，或都是 `fallback` 采样），我们将缓存正在执行的 `Promise`。
* 如果有并发的相同请求到达，直接返回正在执行的 `Promise`，从而共享同一次 `nvidia-smi` 的执行结果。

### 2.2 全局互斥锁 (Global Mutex)
* 针对不同类型的请求（例如 `primary` 和 `fallback` 同时发生，或者未来的其他 `nvidia-smi` 调用），我们将使用一个全局的异步互斥锁（Mutex）。
* 确保在任何时刻，底层真正调用 `execFileAsync(nvidiaSmi, ...)` 的进程只有一个。其他请求需要排队等待当前进程结束后再执行。

## 3. 代码结构调整

* **新增 `lib/monitoring/samplers/nvidiaRunner.ts`**
  * 实现 `Mutex` 锁机制。
  * 实现 `withSharedPromise` 逻辑。
  * 导出一个安全的、带锁的 `runNvidiaSmi(commandArgs, key)` 函数。

* **修改 `lib/monitoring/samplers/gpuPrimary.ts` 和 `gpuFallback.ts`**
  * 将原有的 `execFileAsync(nvidiaSmi, ...)` 替换为调用 `nvidiaRunner.ts` 提供的安全执行函数。
