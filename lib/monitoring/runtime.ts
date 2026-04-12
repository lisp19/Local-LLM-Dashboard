import type { DashboardData, HealthSnapshot } from './contracts';

// Stub implementation - will be replaced in Task 6
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runtimeInstance: any = null;

export async function ensureMonitoringRuntimeStarted(): Promise<void> {
  // Will be implemented in Task 6
  if (!runtimeInstance) {
    runtimeInstance = { started: true };
  }
}

export function getLegacyDashboardSnapshotOnce(): DashboardData {
  if (!runtimeInstance) {
    throw new Error('Monitoring runtime has not been started yet');
  }
  // Stub returns empty data until runtime is implemented
  return {
    system: { cpuUsage: 0, cpuCores: 0, cpuModel: 'Unknown', osRelease: 'Unknown', memory: { total: 0, used: 0, free: 0 } },
    gpus: [],
    containers: [],
  };
}

export function getHealthSnapshotOnce(): HealthSnapshot {
  if (!runtimeInstance) {
    throw new Error('Monitoring runtime has not been started yet');
  }
  return {
    dispatchers: [],
    queue: { topicCount: 0, groupCount: 0, consumerCount: 0, droppedMessages: 0 },
    agents: [],
    events: [],
  };
}
