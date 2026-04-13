export type DispatcherMode = 'primary' | 'fallback';
export type DispatcherHealth = 'healthy' | 'degraded' | 'failed';

export interface SystemMetrics {
  cpuUsage: number;
  cpuCores: number;
  cpuModel: string;
  osRelease: string;
  memory: {
    total: number;
    used: number;
    free: number;
  };
}

export interface GpuMetrics {
  id: string;
  name: string;
  type: 'Nvidia' | 'AMD';
  utilization: string;
  memoryUsed: string;
  memoryTotal: string;
  temperature: string;
  powerDraw: string;
  powerLimit: string;
  fanSpeed: string;
}

export interface ContainerMetrics {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  publishedPort: string | null;
  cpuPercent: string;
  memUsage: string;
  memUsedRaw: number;
  gpus: string[];
}

export interface DashboardData {
  system: SystemMetrics;
  gpus: GpuMetrics[];
  containers: Array<{
    runtime: ContainerMetrics;
    modelConfig: Record<string, string | number | boolean> | null;
  }>;
}

export interface DispatcherState {
  name: string;
  mode: DispatcherMode;
  health: DispatcherHealth;
  consecutivePrimaryFailures: number;
  consecutiveFallbackFailures: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  lastLatencyMs: number | null;
  intervalMs: number;
}

export interface HealthSnapshot {
  dispatchers: DispatcherState[];
  queue: {
    topicCount: number;
    groupCount: number;
    consumerCount: number;
    pendingDeliveries: number;
    bufferOverwrites: string;
    ackedDeliveries: string;
    timedOutDeliveries: string;
    consumerErrors: string;
  };
  agents: Array<{
    sourceId: string;
    agentId: string;
    lastSeenAt: number;
    transport: 'http' | 'socket.io';
  }>;
  events: Array<{
    type: 'degraded' | 'recovered' | 'error';
    dispatcher: string;
    message: string;
    timestamp: number;
  }>;
}

export interface CoreSnapshot {
  dashboard: DashboardData;
  updatedAt: number;
}

export interface MetricEnvelope<TPayload = unknown> {
  id: string;
  topic: string;
  metricKey: string;
  sourceId: string;
  agentId: string;
  producerId: string;
  timestamp: number;
  sequence: number;
  payload: TPayload;
  meta: {
    mode: DispatcherMode;
    latencyMs: number;
    sampleWindowMs: number;
    degraded: boolean;
    errorCount: number;
    schemaVersion: 1;
  };
}
