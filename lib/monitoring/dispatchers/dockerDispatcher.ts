import { createDispatcher, makePublishHealth, type RunningDispatcher, type SharedRuntimeDeps } from './createDispatcher';
import { MONITOR_TOPICS } from '../topics';
import { sampleDockerApi } from '../samplers/dockerApi';
import { sampleDockerCli } from '../samplers/dockerCli';

export function createDockerDispatcher(deps: SharedRuntimeDeps): RunningDispatcher {
  return createDispatcher({
    name: 'docker-dispatcher',
    topic: MONITOR_TOPICS.metricsDocker,
    metricKey: 'docker.container.stats',
    config: deps.config.dispatchers.docker,
    sourceId: deps.sourceId,
    agentId: deps.agentId,
    primary: sampleDockerApi,
    fallback: sampleDockerCli,
    publish: deps.publish,
    publishHealth: makePublishHealth(deps.publish, deps.sourceId, deps.agentId),
  });
}
