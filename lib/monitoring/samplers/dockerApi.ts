import Docker from 'dockerode';
import type { ContainerMetrics } from '../contracts';

const docker = new Docker();

interface DockerStats {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
  };
  memory_stats: {
    usage: number;
    limit: number;
  };
}

function calcCpuPercent(stats: DockerStats): string {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const numCpus = stats.cpu_stats.online_cpus ?? 1;
  if (systemDelta <= 0 || cpuDelta < 0) return '0.00%';
  return `${((cpuDelta / systemDelta) * numCpus * 100).toFixed(2)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GiB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)}KiB`;
  return `${bytes}B`;
}

// Cache inspect results to avoid serial slowness
const inspectCache = new Map<string, { gpus: string[]; expiry: number }>();
const INSPECT_TTL_MS = 30_000;

async function getGpuBindings(containerId: string): Promise<string[]> {
  const cached = inspectCache.get(containerId);
  if (cached && Date.now() < cached.expiry) return cached.gpus;

  try {
    const container = docker.getContainer(containerId);
    const inspectData = await container.inspect();
    const deviceRequests = inspectData.HostConfig?.DeviceRequests ?? [];
    const gpus: string[] = [];
    for (const req of deviceRequests) {
      if (req.Capabilities?.some((cap) => cap.includes('gpu'))) {
        if (req.DeviceIDs && req.DeviceIDs.length > 0) {
          gpus.push(...req.DeviceIDs);
        } else if (req.Count === -1) {
          gpus.push('all');
        } else if (req.Count) {
          gpus.push(String(req.Count));
        }
      }
    }
    inspectCache.set(containerId, { gpus, expiry: Date.now() + INSPECT_TTL_MS });
    return gpus;
  } catch {
    return [];
  }
}

export async function sampleDockerApi(): Promise<ContainerMetrics[]> {
  const containers = await docker.listContainers({ all: false });
  if (containers.length === 0) return [];

  const settled = await Promise.allSettled(
    containers.map(async (c) => {
      const instance = docker.getContainer(c.Id);
      const [statsRaw, gpus] = await Promise.all([
        instance.stats({ stream: false }) as Promise<DockerStats>,
        getGpuBindings(c.Id),
      ]);

      const memUsed = statsRaw.memory_stats.usage ?? 0;
      const memLimit = statsRaw.memory_stats.limit ?? 0;
      const memUsage = `${formatBytes(memUsed)} / ${formatBytes(memLimit)}`;
      const cpuPercent = calcCpuPercent(statsRaw);
      const ports = c.Ports.map((p) => {
        if (p.PublicPort) return `${p.PublicPort}->${p.PrivatePort}/${p.Type}`;
        return `${p.PrivatePort}/${p.Type}`;
      }).join(', ');
      const publishedPort = c.Ports.find((p) => p.PublicPort)?.PublicPort;

      return {
        id: c.Id.slice(0, 12),
        name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
        image: c.Image,
        status: c.Status,
        ports,
        publishedPort: publishedPort ? String(publishedPort) : null,
        cpuPercent,
        memUsage,
        memUsedRaw: memUsed,
        gpus,
      };
    }),
  );

  const metrics = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));

  // Preserve the last good snapshot when Docker is temporarily unhealthy.
  if (metrics.length === 0) {
    throw new Error('Docker API sampling failed for all running containers');
  }

  return metrics;
}
