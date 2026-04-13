export type MonitorProtocolMode = 'legacy' | 'modern';

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
}

const monitorProtocolMode = (process.env.NEXT_PUBLIC_MONITOR_PROTOCOL_MODE ?? 'legacy') as MonitorProtocolMode;
const enableExternalAgent = process.env.ENABLE_EXTERNAL_AGENT !== 'false';
const queueSamplingIntervalMs = parsePositiveInteger(process.env.MONITOR_QUEUE_SAMPLING_INTERVAL_MS, 10000);
const queueRingBufferSize = parsePositiveInteger(process.env.MONITOR_QUEUE_RING_BUFFER_SIZE, 64);

export const monitorEnv = {
  monitorProtocolMode,
  enableExternalAgent,
  queueSamplingIntervalMs,
  queueRingBufferSize,
} as const;
