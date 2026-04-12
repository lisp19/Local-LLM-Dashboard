import type {
  MetricEnvelope,
  CoreSnapshot,
  DashboardData,
  SystemMetrics,
  GpuMetrics,
  ContainerMetrics,
} from '../contracts';
import { MONITOR_TOPICS } from '../topics';

export interface CoreProjector {
  apply(envelope: MetricEnvelope): void;
  getSnapshot(): CoreSnapshot;
}

const DEFAULT_SYSTEM: SystemMetrics = {
  cpuUsage: 0,
  cpuCores: 0,
  cpuModel: 'Unknown',
  osRelease: 'Unknown',
  memory: { total: 0, used: 0, free: 0 },
};

export function createCoreProjector(): CoreProjector {
  let system: SystemMetrics = DEFAULT_SYSTEM;
  let gpus: GpuMetrics[] = [];
  let containers: ContainerMetrics[] = [];
  let modelConfig: Record<string, Record<string, string | number | boolean>> = {};
  let updatedAt = 0;

  function buildDashboard(): DashboardData {
    const configKeys = Object.keys(modelConfig);
    const joinedContainers = containers.map((runtime) => ({
      runtime,
      modelConfig: modelConfig[runtime.name] ?? null,
    }));

    joinedContainers.sort((a, b) => {
      const idxA = configKeys.indexOf(a.runtime.name);
      const idxB = configKeys.indexOf(b.runtime.name);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return 0;
    });

    return { system, gpus, containers: joinedContainers };
  }

  return {
    apply(envelope: MetricEnvelope): void {
      switch (envelope.topic) {
        case MONITOR_TOPICS.metricsSystem:
          system = envelope.payload as SystemMetrics;
          break;
        case MONITOR_TOPICS.metricsGpu:
          gpus = envelope.payload as GpuMetrics[];
          break;
        case MONITOR_TOPICS.metricsDocker:
          containers = envelope.payload as ContainerMetrics[];
          break;
        case MONITOR_TOPICS.configModel:
          modelConfig = envelope.payload as Record<string, Record<string, string | number | boolean>>;
          break;
        default:
          return;
      }
      updatedAt = Date.now();
    },

    getSnapshot(): CoreSnapshot {
      return { dashboard: buildDashboard(), updatedAt };
    },
  };
}
