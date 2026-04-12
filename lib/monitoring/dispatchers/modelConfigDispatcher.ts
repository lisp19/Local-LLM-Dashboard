import { createDispatcher, makePublishHealth, type RunningDispatcher, type SharedRuntimeDeps } from './createDispatcher';
import { MONITOR_TOPICS } from '../topics';
import { sampleModelConfigPrimary } from '../samplers/modelConfigPrimary';
import { sampleModelConfigFallback, updateModelConfigFallbackCache } from '../samplers/modelConfigFallback';

export function createModelConfigDispatcher(deps: SharedRuntimeDeps): RunningDispatcher {
  async function primary() {
    const config = await sampleModelConfigPrimary();
    updateModelConfigFallbackCache(config);
    return config;
  }

  return createDispatcher({
    name: 'model-config-dispatcher',
    topic: MONITOR_TOPICS.configModel,
    metricKey: 'config.model',
    config: deps.config.dispatchers.modelConfig,
    sourceId: deps.sourceId,
    agentId: deps.agentId,
    primary,
    fallback: sampleModelConfigFallback,
    publish: deps.publish,
    publishHealth: makePublishHealth(deps.publish, deps.sourceId, deps.agentId),
  });
}
