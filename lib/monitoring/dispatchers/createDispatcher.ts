import type { MetricEnvelope, DispatcherState, DispatcherMode, DispatcherHealth } from '../contracts';
import type { DispatcherRuntimeConfig } from '../../config/types';
import { MONITOR_TOPICS } from '../topics';
import { randomUUID } from 'crypto';

export interface DispatcherDependencies<TPayload> {
  name: string;
  topic: string;
  metricKey: string;
  config: DispatcherRuntimeConfig;
  sourceId: string;
  agentId: string;
  primary: () => Promise<TPayload>;
  fallback: () => Promise<TPayload>;
  publish: (event: MetricEnvelope<TPayload>) => void;
  publishHealth: (state: DispatcherState, eventType?: 'degraded' | 'recovered' | 'error', message?: string) => void;
}

export interface RunningDispatcher {
  start(): void;
  stop(): Promise<void>;
  getState(): DispatcherState;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export function createDispatcher<TPayload>(deps: DispatcherDependencies<TPayload>): RunningDispatcher {
  const { name, topic, metricKey, config, sourceId, agentId, primary, fallback, publish, publishHealth } = deps;

  const state: DispatcherState = {
    name,
    mode: 'primary' as DispatcherMode,
    health: 'healthy' as DispatcherHealth,
    consecutivePrimaryFailures: 0,
    consecutiveFallbackFailures: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    lastLatencyMs: null,
    intervalMs: config.intervalMs,
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let errorCount = 0;

  function buildEnvelope(payload: TPayload, mode: DispatcherMode, latencyMs: number): Omit<MetricEnvelope<TPayload>, 'sequence'> {
    return {
      id: randomUUID(),
      topic,
      metricKey,
      sourceId,
      agentId,
      producerId: name,
      timestamp: Date.now(),
      payload,
      meta: {
        mode,
        latencyMs,
        sampleWindowMs: config.intervalMs,
        degraded: state.health === 'degraded',
        errorCount,
        schemaVersion: 1,
      },
    };
  }

  async function runCycle(): Promise<void> {
    if (!config.enabled) return;

    const start = Date.now();

    // In degraded mode, run fallback directly (probe is separate)
    if (state.health === 'degraded') {
      try {
        const payload = await withTimeout(fallback(), config.timeoutMs);
        const latencyMs = Date.now() - start;
        state.lastSuccessAt = Date.now();
        state.lastLatencyMs = latencyMs;
        state.consecutiveFallbackFailures = 0;
        publish(buildEnvelope(payload, 'fallback', latencyMs) as MetricEnvelope<TPayload>);
        publishHealth(state);
      } catch (err) {
        state.lastErrorAt = Date.now();
        state.lastErrorMessage = err instanceof Error ? err.message : String(err);
        state.consecutiveFallbackFailures++;
        errorCount++;
        if (state.consecutiveFallbackFailures >= config.degradeAfterFailures) {
          state.health = 'failed';
          publishHealth(state, 'error', state.lastErrorMessage ?? undefined);
        } else {
          publishHealth(state, 'error', state.lastErrorMessage ?? undefined);
        }
      }
      return;
    }

    // Normal mode: try primary, then fallback
    let primaryError: Error | null = null;
    let payload: TPayload | null = null;
    let usedMode: DispatcherMode = 'primary';

    try {
      payload = await withTimeout(primary(), config.timeoutMs);
      const latencyMs = Date.now() - start;
      state.consecutivePrimaryFailures = 0;
      state.lastSuccessAt = Date.now();
      state.lastLatencyMs = latencyMs;
      publish(buildEnvelope(payload, 'primary', latencyMs) as MetricEnvelope<TPayload>);
      publishHealth(state);
      return;
    } catch (err) {
      primaryError = err instanceof Error ? err : new Error(String(err));
      state.consecutivePrimaryFailures++;
      errorCount++;
    }

    // Try fallback
    try {
      payload = await withTimeout(fallback(), config.timeoutMs);
      usedMode = 'fallback';
      const latencyMs = Date.now() - start;
      state.lastSuccessAt = Date.now();
      state.lastLatencyMs = latencyMs;
      state.consecutiveFallbackFailures = 0;
      publish(buildEnvelope(payload, usedMode, latencyMs) as MetricEnvelope<TPayload>);

      // Check if we need to enter degraded mode
      if (state.consecutivePrimaryFailures >= config.degradeAfterFailures) {
        state.health = 'degraded';
        state.mode = 'fallback';
        publishHealth(state, 'degraded', `Primary failed ${state.consecutivePrimaryFailures} times, entering degraded mode`);
      } else {
        publishHealth(state, 'error', primaryError?.message ?? 'Primary failed');
      }
    } catch (fallbackErr) {
      state.lastErrorAt = Date.now();
      state.lastErrorMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      state.consecutiveFallbackFailures++;
      errorCount++;
      publishHealth(state, 'error', `Primary: ${primaryError?.message ?? '?'}, Fallback: ${state.lastErrorMessage}`);
    }
  }

  async function probeRecovery(): Promise<void> {
    if (state.health !== 'degraded' || !running) return;
    try {
      const payload = await withTimeout(primary(), config.timeoutMs);
      const latencyMs = Date.now() - Date.now();
      state.consecutivePrimaryFailures = 0;
      state.lastSuccessAt = Date.now();
      state.lastLatencyMs = latencyMs;
      
      // Check if enough consecutive successes to recover
      // We use a simple counter by leveraging consecutivePrimaryFailures = 0 means success
      const prevHealth = state.health;
      if (prevHealth === 'degraded') {
        state.health = 'healthy';
        state.mode = 'primary';
        publishHealth(state, 'recovered', 'Primary sampler recovered');
        publish(buildEnvelope(payload, 'primary', latencyMs) as MetricEnvelope<TPayload>);
      }
    } catch {
      // Still not recovered, keep degraded
    }
  }

  function scheduleNext(): void {
    if (!running) return;
    timer = setTimeout(async () => {
      await runCycle();
      scheduleNext();
    }, config.intervalMs);
  }

  function scheduleProbe(): void {
    if (!running) return;
    probeTimer = setTimeout(async () => {
      if (state.health === 'degraded') {
        await probeRecovery();
      }
      scheduleProbe();
    }, config.apiProbeIntervalMs);
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      // Kick off immediate first run
      runCycle().then(() => scheduleNext()).catch(() => scheduleNext());
      scheduleProbe();
    },

    async stop(): Promise<void> {
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
      if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; }
    },

    getState(): DispatcherState {
      return { ...state };
    },
  };
}

export interface SharedRuntimeDeps {
  config: import('../../config/types').MonitoringConfig;
  sourceId: string;
  agentId: string;
  publish: (event: MetricEnvelope) => void;
  publishHealth: (state: DispatcherState, eventType?: 'degraded' | 'recovered' | 'error', message?: string) => void;
}

export function makePublishHealth(
  publish: (event: MetricEnvelope) => void,
  sourceId: string,
  agentId: string,
): (state: DispatcherState, eventType?: 'degraded' | 'recovered' | 'error', message?: string) => void {
  return (state, eventType, message) => {
    publish({
      id: randomUUID(),
      topic: MONITOR_TOPICS.healthDispatcher,
      metricKey: 'dispatcher.state',
      sourceId,
      agentId,
      producerId: state.name,
      timestamp: Date.now(),
      sequence: 0,
      payload: { ...state, eventType, message },
      meta: {
        mode: state.mode,
        latencyMs: state.lastLatencyMs ?? 0,
        sampleWindowMs: state.intervalMs,
        degraded: state.health === 'degraded',
        errorCount: state.consecutivePrimaryFailures,
        schemaVersion: 1,
      },
    });
  };
}
