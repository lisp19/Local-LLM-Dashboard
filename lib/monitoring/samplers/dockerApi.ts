import Docker from 'dockerode';
import type { Readable } from 'stream';
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

interface DockerStatsStreamEntry {
  stream: Readable | null;
  latestStats: DockerStats | null;
  previousStats: DockerStats | null;
  syncState: 'syncing' | 'ok';
  lastUpdateAt: number | null;
  starting: boolean;
  destroyed: boolean;
}

type RunningContainer = Awaited<ReturnType<Docker['listContainers']>>[number];

const inspectCache = new Map<string, { gpus: string[]; expiry: number }>();
const statsStreamCache = new Map<string, DockerStatsStreamEntry>();
const INSPECT_TTL_MS = 30_000;

function calcCpuPercent(current: DockerStats, previous: DockerStats): string {
  const cpuDelta = current.cpu_stats.cpu_usage.total_usage - previous.cpu_stats.cpu_usage.total_usage;
  const systemDelta = current.cpu_stats.system_cpu_usage - previous.cpu_stats.system_cpu_usage;
  const numCpus = current.cpu_stats.online_cpus ?? 1;
  if (systemDelta <= 0 || cpuDelta < 0) return '0.00%';
  return `${((cpuDelta / systemDelta) * numCpus * 100).toFixed(2)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GiB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)}KiB`;
  return `${bytes}B`;
}

function createStatsEntry(): DockerStatsStreamEntry {
  return {
    stream: null,
    latestStats: null,
    previousStats: null,
    syncState: 'syncing',
    lastUpdateAt: null,
    starting: false,
    destroyed: false,
  };
}

function parseStatsChunk(chunk: Buffer): DockerStats | null {
  const raw = chunk.toString('utf8').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DockerStats;
  } catch {
    return null;
  }
}

function getPorts(container: RunningContainer): string {
  return container.Ports.map((port) => {
    if (port.PublicPort) return `${port.PublicPort}->${port.PrivatePort}/${port.Type}`;
    return `${port.PrivatePort}/${port.Type}`;
  }).join(', ');
}

function getPublishedPort(container: RunningContainer): string | null {
  const publishedPort = container.Ports.find((port) => port.PublicPort)?.PublicPort;
  return publishedPort ? String(publishedPort) : null;
}

function getContainerName(container: RunningContainer): string {
  return container.Names[0]?.replace(/^\//, '') ?? container.Id.slice(0, 12);
}

function getCpuDisplay(entry: DockerStatsStreamEntry | undefined): string {
  if (!entry?.latestStats || !entry.previousStats || entry.syncState !== 'ok') {
    return '0.00%';
  }
  return calcCpuPercent(entry.latestStats, entry.previousStats);
}

function getMemoryFields(entry: DockerStatsStreamEntry | undefined): { memUsage: string; memUsedRaw: number } {
  const memUsed = entry?.latestStats?.memory_stats.usage ?? 0;
  const memLimit = entry?.latestStats?.memory_stats.limit ?? 0;
  return {
    memUsage: `${formatBytes(memUsed)} / ${formatBytes(memLimit)}`,
    memUsedRaw: memUsed,
  };
}

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

function ensureStatsStream(containerId: string, containerName: string): void {
  const existing = statsStreamCache.get(containerId);
  if (existing?.stream || existing?.starting) return;

  const entry = existing ?? createStatsEntry();
  entry.starting = true;
  entry.destroyed = false;
  entry.syncState = 'syncing';
  statsStreamCache.set(containerId, entry);

  console.log(`[docker-stats] starting stream for ${containerName} (${containerId.slice(0, 12)})`);

  void (async () => {
    try {
      const stream = await docker.getContainer(containerId).stats({ stream: true }) as Readable;
      if (entry.destroyed) {
        stream.destroy();
        entry.starting = false;
        return;
      }

      entry.stream = stream;
      entry.starting = false;

      stream.on('data', (chunk: Buffer) => {
        const stats = parseStatsChunk(chunk);
        if (!stats) return;

        const hadPreviousSample = entry.latestStats !== null;
        if (entry.latestStats) {
          entry.previousStats = entry.latestStats;
        }
        entry.latestStats = stats;
        entry.lastUpdateAt = Date.now();

        if (!hadPreviousSample) {
          console.log(`[docker-stats] syncing ${containerName} (${containerId.slice(0, 12)}): first stats received`);
          return;
        }

        if (entry.syncState !== 'ok') {
          console.log(`[docker-stats] ok ${containerName} (${containerId.slice(0, 12)}): cpu samples ready`);
        }
        entry.syncState = 'ok';
      });

      stream.on('error', (error: Error) => {
        if (entry.destroyed) return;
        console.error(`[docker-stats] stream error for ${containerName} (${containerId.slice(0, 12)}): ${error.message}`);
        if (entry.stream === stream) {
          entry.stream = null;
        }
        entry.starting = false;
        entry.syncState = 'syncing';
      });

      stream.on('close', () => {
        if (entry.destroyed) return;
        console.warn(`[docker-stats] stream closed for ${containerName} (${containerId.slice(0, 12)}), will recreate on next sample`);
        if (entry.stream === stream) {
          entry.stream = null;
        }
        entry.starting = false;
        entry.syncState = 'syncing';
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[docker-stats] failed to start stream for ${containerName} (${containerId.slice(0, 12)}): ${message}`);
      entry.stream = null;
      entry.starting = false;
      entry.syncState = 'syncing';
    }
  })();
}

function cleanupMissingStreams(activeIds: Set<string>): void {
  for (const [containerId, entry] of statsStreamCache.entries()) {
    if (activeIds.has(containerId)) continue;

    entry.destroyed = true;
    entry.stream?.destroy();
    statsStreamCache.delete(containerId);
    console.log(`[docker-stats] removed stream cache for ${containerId.slice(0, 12)}`);
  }
}

function buildContainerMetric(
  container: RunningContainer,
  entry: DockerStatsStreamEntry | undefined,
  gpus: string[],
): ContainerMetrics {
  const { memUsage, memUsedRaw } = getMemoryFields(entry);

  return {
    id: container.Id.slice(0, 12),
    name: getContainerName(container),
    image: container.Image,
    status: container.Status,
    ports: getPorts(container),
    publishedPort: getPublishedPort(container),
    cpuPercent: getCpuDisplay(entry),
    memUsage,
    memUsedRaw,
    gpus,
    syncState: entry?.syncState ?? 'syncing',
  };
}

export async function sampleDockerApi(): Promise<ContainerMetrics[]> {
  const containers = await docker.listContainers({ all: false });
  const activeIds = new Set(containers.map((container) => container.Id));
  cleanupMissingStreams(activeIds);

  if (containers.length === 0) return [];

  const settled = await Promise.allSettled(
    containers.map(async (container): Promise<ContainerMetrics> => {
      const containerName = getContainerName(container);
      ensureStatsStream(container.Id, containerName);
      const gpus = await getGpuBindings(container.Id);
      const entry = statsStreamCache.get(container.Id);
      return buildContainerMetric(container, entry, gpus);
    }),
  );

  const metrics = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));

  if (metrics.length === 0) {
    throw new Error('Docker API sampling failed for all running containers');
  }

  return metrics;
}
