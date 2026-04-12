export interface DispatcherRuntimeConfig {
  enabled: boolean;
  intervalMs: number;
  timeoutMs: number;
  degradeAfterFailures: number;
  recoverAfterSuccesses: number;
  apiProbeIntervalMs: number;
}

export interface MonitoringConfig {
  openWebUIPort: number;
  vllmApiKey: string;
  pythonPath: string;
  benchmarkPlotDir: string;
  dispatchers: {
    system: DispatcherRuntimeConfig;
    docker: DispatcherRuntimeConfig;
    gpu: DispatcherRuntimeConfig;
    modelConfig: DispatcherRuntimeConfig;
  };
  agent: {
    allowExternalReport: boolean;
    reportToken: string;
  };
  snapshot: {
    maxAgeMs: number;
  };
  health: {
    retentionLimit: number;
  };
  diskPinnedDirs?: string[];
}
