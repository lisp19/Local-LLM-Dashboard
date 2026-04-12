import type { DashboardData, SystemMetrics, GpuMetrics, ContainerMetrics } from './monitoring/contracts';
import { ensureMonitoringRuntimeStarted, getLegacyDashboardSnapshotOnce } from './monitoring/runtime';

export type { DashboardData, SystemMetrics, GpuMetrics, ContainerMetrics };

export interface ModelConfig {
  [containerName: string]: Record<string, string | number | boolean>;
}

export async function getDashboardData(): Promise<DashboardData> {
  await ensureMonitoringRuntimeStarted();
  return getLegacyDashboardSnapshotOnce();
}
