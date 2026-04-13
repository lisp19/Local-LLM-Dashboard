var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createMessageBus } from './bus';
import { createCoreProjector } from './projectors/coreProjector';
import { createHealthProjector } from './projectors/healthProjector';
import { MONITOR_TOPICS, SUBSCRIPTION_GROUPS } from './topics';
import { createSystemDispatcher } from './dispatchers/systemDispatcher';
import { createDockerDispatcher } from './dispatchers/dockerDispatcher';
import { createGpuDispatcher } from './dispatchers/gpuDispatcher';
import { createModelConfigDispatcher } from './dispatchers/modelConfigDispatcher';
import { loadMonitoringConfig } from '../config/loadConfig';
import { randomUUID } from 'crypto';
let runtimePromise = null;
let runtimeInstance = null;
function subscribeProjectors(bus, coreProjector, healthProjector) {
    // Core snapshot topics
    bus.subscribe(MONITOR_TOPICS.metricsSystem, SUBSCRIPTION_GROUPS.snapshotCore, (event) => coreProjector.apply(event));
    bus.subscribe(MONITOR_TOPICS.metricsDocker, SUBSCRIPTION_GROUPS.snapshotCore, (event) => coreProjector.apply(event));
    bus.subscribe(MONITOR_TOPICS.metricsGpu, SUBSCRIPTION_GROUPS.snapshotCore, (event) => coreProjector.apply(event));
    bus.subscribe(MONITOR_TOPICS.configModel, SUBSCRIPTION_GROUPS.snapshotCore, (event) => coreProjector.apply(event));
    // Health snapshot topics
    bus.subscribe(MONITOR_TOPICS.healthDispatcher, SUBSCRIPTION_GROUPS.snapshotHealth, (event) => {
        healthProjector.apply(event);
        healthProjector.updateQueueStats(bus);
    });
    bus.subscribe(MONITOR_TOPICS.agentReport, SUBSCRIPTION_GROUPS.snapshotHealth, (event) => healthProjector.apply(event));
}
function createMonitoringRuntime() {
    return __awaiter(this, void 0, void 0, function* () {
        const config = yield loadMonitoringConfig();
        const bus = createMessageBus();
        const coreProjector = createCoreProjector();
        const healthProjector = createHealthProjector();
        subscribeProjectors(bus, coreProjector, healthProjector);
        function publish(event) {
            bus.publish(event);
        }
        function publishHealth(state, eventType, message) {
            var _a;
            bus.publish({
                id: randomUUID(),
                topic: MONITOR_TOPICS.healthDispatcher,
                metricKey: 'dispatcher.state',
                sourceId: 'local',
                agentId: 'local-main',
                producerId: state.name,
                timestamp: Date.now(),
                payload: Object.assign(Object.assign({}, state), { eventType, message }),
                meta: {
                    mode: state.mode,
                    latencyMs: (_a = state.lastLatencyMs) !== null && _a !== void 0 ? _a : 0,
                    sampleWindowMs: state.intervalMs,
                    degraded: state.health === 'degraded',
                    errorCount: state.consecutivePrimaryFailures,
                    schemaVersion: 1,
                },
            });
        }
        const sharedDeps = {
            config,
            sourceId: 'local',
            agentId: 'local-main',
            publish,
            publishHealth,
        };
        const dispatchers = [
            createSystemDispatcher(sharedDeps),
            createDockerDispatcher(sharedDeps),
            createGpuDispatcher(sharedDeps),
            createModelConfigDispatcher(sharedDeps),
        ];
        const runtime = {
            start() {
                return __awaiter(this, void 0, void 0, function* () {
                    for (const dispatcher of dispatchers) {
                        dispatcher.start();
                    }
                });
            },
            stop() {
                return __awaiter(this, void 0, void 0, function* () {
                    for (const dispatcher of dispatchers) {
                        yield dispatcher.stop();
                    }
                });
            },
            getDashboardSnapshot() {
                return coreProjector.getSnapshot().dashboard;
            },
            getHealthSnapshot() {
                healthProjector.updateQueueStats(bus);
                return healthProjector.getSnapshot();
            },
            getBus() {
                return bus;
            },
        };
        yield runtime.start();
        return runtime;
    });
}
export function ensureMonitoringRuntimeStarted() {
    return __awaiter(this, void 0, void 0, function* () {
        if (runtimeInstance)
            return runtimeInstance;
        if (!runtimePromise) {
            runtimePromise = createMonitoringRuntime().then((rt) => {
                runtimeInstance = rt;
                return rt;
            });
        }
        return runtimePromise;
    });
}
export function getLegacyDashboardSnapshotOnce() {
    if (!runtimeInstance) {
        throw new Error('Monitoring runtime has not been started yet');
    }
    return runtimeInstance.getDashboardSnapshot();
}
export function getHealthSnapshotOnce() {
    if (!runtimeInstance) {
        throw new Error('Monitoring runtime has not been started yet');
    }
    return runtimeInstance.getHealthSnapshot();
}
export function getMonitoringRuntimeInstance() {
    return runtimeInstance;
}
