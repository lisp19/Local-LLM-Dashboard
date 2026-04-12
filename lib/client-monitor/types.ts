import type { DashboardData, HealthSnapshot } from '../monitoring/contracts';

export interface ClientMonitorState {
  dashboard: DashboardData | null;
  health: HealthSnapshot | null;
  status: 'idle' | 'loading' | 'live' | 'error';
  error: string | null;
  lastUpdatedAt: number | null;
  containerUpdatedAt: Record<string, number>;
}
