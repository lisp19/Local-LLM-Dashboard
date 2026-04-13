import { MONITOR_TOPICS } from '../topics';
const DEFAULT_SYSTEM = {
    cpuUsage: 0,
    cpuCores: 0,
    cpuModel: 'Unknown',
    osRelease: 'Unknown',
    memory: { total: 0, used: 0, free: 0 },
};
export function createCoreProjector() {
    let system = DEFAULT_SYSTEM;
    let gpus = [];
    let containers = [];
    let modelConfig = {};
    let updatedAt = 0;
    function buildDashboard() {
        const configKeys = Object.keys(modelConfig);
        const joinedContainers = containers.map((runtime) => {
            var _a;
            return ({
                runtime,
                modelConfig: (_a = modelConfig[runtime.name]) !== null && _a !== void 0 ? _a : null,
            });
        });
        joinedContainers.sort((a, b) => {
            const idxA = configKeys.indexOf(a.runtime.name);
            const idxB = configKeys.indexOf(b.runtime.name);
            if (idxA !== -1 && idxB !== -1)
                return idxA - idxB;
            if (idxA !== -1)
                return -1;
            if (idxB !== -1)
                return 1;
            return 0;
        });
        return { system, gpus, containers: joinedContainers };
    }
    return {
        apply(envelope) {
            switch (envelope.topic) {
                case MONITOR_TOPICS.metricsSystem:
                    system = envelope.payload;
                    break;
                case MONITOR_TOPICS.metricsGpu:
                    gpus = envelope.payload;
                    break;
                case MONITOR_TOPICS.metricsDocker:
                    containers = envelope.payload;
                    break;
                case MONITOR_TOPICS.configModel:
                    modelConfig = envelope.payload;
                    break;
                default:
                    return;
            }
            updatedAt = Date.now();
        },
        getSnapshot() {
            return { dashboard: buildDashboard(), updatedAt };
        },
    };
}
