import { createDispatcher, makePublishHealth, type RunningDispatcher, type SharedRuntimeDeps } from './createDispatcher';
import { MONITOR_TOPICS } from '../topics';
import { sampleGpuPrimary } from '../samplers/gpuPrimary';
import { sampleGpuFallback } from '../samplers/gpuFallback';

export function createGpuDispatcher(deps: SharedRuntimeDeps): RunningDispatcher {
  return createDispatcher({
    name: 'gpu-dispatcher',
    topic: MONITOR_TOPICS.metricsGpu,
    metricKey: 'gpu.device.stats',
    config: deps.config.dispatchers.gpu,
    sourceId: deps.sourceId,
    agentId: deps.agentId,
    primary: sampleGpuPrimary,
    fallback: sampleGpuFallback,
    publish: deps.publish,
    publishHealth: makePublishHealth(deps.publish, deps.sourceId, deps.agentId),
  });
}
