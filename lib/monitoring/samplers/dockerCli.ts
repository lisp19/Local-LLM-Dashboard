import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ContainerMetrics } from '../contracts';

const execFileAsync = promisify(execFile);

function parseMemBytes(memStr: string): number {
  if (!memStr) return 0;
  const usedPart = memStr.split('/')[0].trim();
  const match = usedPart.match(/^([0-9.]+)\s*([a-zA-Z]*)$/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const units: Record<string, number> = {
    b: 1,
    kib: 1024,
    mib: 1024 * 1024,
    gib: 1024 * 1024 * 1024,
    tib: 1024 * 1024 * 1024 * 1024,
    kb: 1000,
    mb: 1000 * 1000,
    gb: 1000 * 1000 * 1000,
    tb: 1000 * 1000 * 1000 * 1000,
  };
  return value * (units[unit] ?? 1);
}

function extractPublishedPort(ports: string): string | null {
  if (!ports) return null;

  const mappings = ports.split(',').map((part) => part.trim()).filter(Boolean);
  for (const mapping of mappings) {
    const directMatch = mapping.match(/^(\d+)->\d+\//);
    if (directMatch) return directMatch[1];

    const hostMatch = mapping.match(/:(\d+)->/);
    if (hostMatch) return hostMatch[1];
  }

  return null;
}

export async function sampleDockerCli(): Promise<ContainerMetrics[]> {
  const { stdout: psStdout } = await execFileAsync('docker', ['ps', '--format', '{{json .}}']);
  if (!psStdout.trim()) return [];

  const containers = psStdout.trim().split('\n').map((line) => JSON.parse(line) as Record<string, string>);

  const { stdout: statsStdout } = await execFileAsync('docker', [
    'stats',
    '--no-stream',
    '--format',
    '{{json .}}',
  ]);
  const statsMap = new Map<string, Record<string, string>>();
  for (const line of statsStdout.trim().split('\n').filter(Boolean)) {
    const stat = JSON.parse(line) as Record<string, string>;
    statsMap.set(stat.ID, stat);
  }

  const metrics: ContainerMetrics[] = [];
  for (const c of containers) {
    const containerId = (c.ID ?? c.Id ?? '') as string;
    const stat = statsMap.get(containerId) ?? {};
    const gpus: string[] = [];

    try {
      const { stdout: inspectOut } = await execFileAsync('docker', ['inspect', containerId]);
      const inspectData = JSON.parse(inspectOut) as Array<{
        HostConfig?: { DeviceRequests?: Array<{ Capabilities: string[][]; DeviceIDs: string[]; Count: number }> };
      }>;
      const deviceRequests = inspectData[0]?.HostConfig?.DeviceRequests ?? [];
      for (const req of deviceRequests) {
        if (req.Capabilities?.some((cap) => cap.includes('gpu'))) {
          if (req.DeviceIDs?.length > 0) {
            gpus.push(...req.DeviceIDs);
          } else if (req.Count === -1) {
            gpus.push('all');
          } else {
            gpus.push(String(req.Count));
          }
        }
      }
    } catch {
      // Ignore inspect errors for one container; keep the runtime metrics snapshot.
    }

    metrics.push({
      id: containerId,
      name: (c.Names ?? c.Name ?? containerId) as string,
      image: (c.Image ?? '') as string,
      status: (c.Status ?? '') as string,
      ports: (c.Ports ?? '') as string,
      publishedPort: extractPublishedPort((c.Ports ?? '') as string),
      cpuPercent: (stat.CPUPerc ?? '0.00%') as string,
      memUsage: (stat.MemUsage ?? '0B / 0B') as string,
      memUsedRaw: parseMemBytes((stat.MemUsage ?? '0B / 0B') as string),
      gpus,
      syncState: 'ok',
    });
  }

  return metrics;
}
