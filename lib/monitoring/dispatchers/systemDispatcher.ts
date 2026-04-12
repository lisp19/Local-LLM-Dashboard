import { createDispatcher, makePublishHealth, type RunningDispatcher, type SharedRuntimeDeps } from './createDispatcher';
import { MONITOR_TOPICS } from '../topics';
import { sampleSystemPrimary } from '../samplers/systemPrimary';
import { sampleSystemFallback } from '../samplers/systemFallback';

export function createSystemDispatcher(deps: SharedRuntimeDeps): RunningDispatcher {
  return createDispatcher({
    name: 'system-dispatcher',
    topic: MONITOR_TOPICS.metricsSystem,
    metricKey: 'cpu.usage',
    config: deps.config.dispatchers.system,
    sourceId: deps.sourceId,
    agentId: deps.agentId,
    primary: sampleSystemPrimary,
    fallback: sampleSystemFallback,
    publish: deps.publish,
    publishHealth: makePublishHealth(deps.publish, deps.sourceId, deps.agentId),
  });
}
