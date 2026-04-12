export type MonitorProtocolMode = 'legacy' | 'modern';

const monitorProtocolMode = (process.env.NEXT_PUBLIC_MONITOR_PROTOCOL_MODE ?? 'legacy') as MonitorProtocolMode;
const enableExternalAgent = process.env.ENABLE_EXTERNAL_AGENT !== 'false';

export const monitorEnv = {
  monitorProtocolMode,
  enableExternalAgent,
} as const;
