import type { DashboardData, HealthSnapshot, MetricEnvelope, DispatcherState } from './contracts';
import { createMessageBus, type MessageBus } from './bus';
import { createCoreProjector } from './projectors/coreProjector';
import { createHealthProjector } from './projectors/healthProjector';
import { MONITOR_TOPICS, SUBSCRIPTION_GROUPS } from './topics';
import { createSystemDispatcher } from './dispatchers/systemDispatcher';
import { createDockerDispatcher } from './dispatchers/dockerDispatcher';
import { createGpuDispatcher } from './dispatchers/gpuDispatcher';
import { createModelConfigDispatcher } from './dispatchers/modelConfigDispatcher';
import { loadMonitoringConfig } from '../config/loadConfig';
import type { RunningDispatcher, SharedRuntimeDeps } from './dispatchers/createDispatcher';
import { randomUUID } from 'crypto';

interface MonitoringRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  getDashboardSnapshot(): DashboardData;
  getHealthSnapshot(): HealthSnapshot;
  getBus(): MessageBus;
}

let runtimePromise: Promise<MonitoringRuntime> | null = null;
let runtimeInstance: MonitoringRuntime | null = null;

function subscribeProjectors(
  bus: MessageBus,
  coreProjector: ReturnType<typeof createCoreProjector>,
  healthProjector: ReturnType<typeof createHealthProjector>,
): void {
  // Core snapshot topics
  bus.subscribe(MONITOR_TOPICS.metricsSystem, SUBSCRIPTION_GROUPS.snapshotCore, (event) =>
    coreProjector.apply(event),
  );
  bus.subscribe(MONITOR_TOPICS.metricsDocker, SUBSCRIPTION_GROUPS.snapshotCore, (event) =>
    coreProjector.apply(event),
  );
  bus.subscribe(MONITOR_TOPICS.metricsGpu, SUBSCRIPTION_GROUPS.snapshotCore, (event) =>
    coreProjector.apply(event),
  );
  bus.subscribe(MONITOR_TOPICS.configModel, SUBSCRIPTION_GROUPS.snapshotCore, (event) =>
    coreProjector.apply(event),
  );

  // Health snapshot topics
  bus.subscribe(MONITOR_TOPICS.healthDispatcher, SUBSCRIPTION_GROUPS.snapshotHealth, (event) => {
    healthProjector.apply(event);
    healthProjector.updateQueueStats(bus);
  });
  bus.subscribe(MONITOR_TOPICS.agentReport, SUBSCRIPTION_GROUPS.snapshotHealth, (event) =>
    healthProjector.apply(event),
  );
}

async function createMonitoringRuntime(): Promise<MonitoringRuntime> {
  const config = await loadMonitoringConfig();
  const bus = createMessageBus();
  const coreProjector = createCoreProjector();
  const healthProjector = createHealthProjector();

  subscribeProjectors(bus, coreProjector, healthProjector);

  function publish(event: MetricEnvelope): void {
    bus.publish(event);
  }

  function publishHealth(
    state: DispatcherState,
    eventType?: 'degraded' | 'recovered' | 'error',
    message?: string,
  ): void {
    bus.publish({
      id: randomUUID(),
      topic: MONITOR_TOPICS.healthDispatcher,
      metricKey: 'dispatcher.state',
      sourceId: 'local',
      agentId: 'local-main',
      producerId: state.name,
      timestamp: Date.now(),
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
  }

  const sharedDeps: SharedRuntimeDeps = {
    config,
    sourceId: 'local',
    agentId: 'local-main',
    publish,
    publishHealth,
  };

  const dispatchers: RunningDispatcher[] = [
    createSystemDispatcher(sharedDeps),
    createDockerDispatcher(sharedDeps),
    createGpuDispatcher(sharedDeps),
    createModelConfigDispatcher(sharedDeps),
  ];

  const runtime: MonitoringRuntime = {
    async start() {
      for (const dispatcher of dispatchers) {
        dispatcher.start();
      }
    },
    async stop() {
      for (const dispatcher of dispatchers) {
        await dispatcher.stop();
      }
    },
    getDashboardSnapshot() {
      return coreProjector.getSnapshot().dashboard;
    },
    getHealthSnapshot() {
      healthProjector.updateQueueStats(bus);
      return healthProjector.getSnapshot();
    },
    getBus() {
      return bus;
    },
  };

  await runtime.start();
  return runtime;
}

export async function ensureMonitoringRuntimeStarted(): Promise<MonitoringRuntime> {
  if (runtimeInstance) return runtimeInstance;
  if (!runtimePromise) {
    runtimePromise = createMonitoringRuntime().then((rt) => {
      runtimeInstance = rt;
      return rt;
    });
  }
  return runtimePromise;
}

export function getLegacyDashboardSnapshotOnce(): DashboardData {
  if (!runtimeInstance) {
    throw new Error('Monitoring runtime has not been started yet');
  }
  return runtimeInstance.getDashboardSnapshot();
}

export function getHealthSnapshotOnce(): HealthSnapshot {
  if (!runtimeInstance) {
    throw new Error('Monitoring runtime has not been started yet');
  }
  return runtimeInstance.getHealthSnapshot();
}

export function getMonitoringRuntimeInstance(): MonitoringRuntime | null {
  return runtimeInstance;
}
