var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { if (result.done) { resolve(result.value); } else { adopt(result.value).then(fulfilled, rejected); } }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import Docker from 'dockerode';
const docker = new Docker();
function calcCpuPercent(stats) {
    var _a;
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numCpus = (_a = stats.cpu_stats.online_cpus) !== null && _a !== void 0 ? _a : 1;
    if (systemDelta <= 0 || cpuDelta < 0)
        return '0.00%';
    return `${((cpuDelta / systemDelta) * numCpus * 100).toFixed(2)}%`;
}
function formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024)
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GiB`;
    if (bytes >= 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(2)}MiB`;
    if (bytes >= 1024)
        return `${(bytes / 1024).toFixed(2)}KiB`;
    return `${bytes}B`;
}
// Cache inspect results to avoid serial slowness
const inspectCache = new Map();
const INSPECT_TTL_MS = 30000;
function getGpuBindings(containerId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const cached = inspectCache.get(containerId);
        if (cached && Date.now() < cached.expiry)
            return cached.gpus;
        try {
            const container = docker.getContainer(containerId);
            const inspectData = yield container.inspect();
            const deviceRequests = (_b = (_a = inspectData.HostConfig) === null || _a === void 0 ? void 0 : _a.DeviceRequests) !== null && _b !== void 0 ? _b : [];
            const gpus = [];
            for (const req of deviceRequests) {
                if ((_c = req.Capabilities) === null || _c === void 0 ? void 0 : _c.some((cap) => cap.includes('gpu'))) {
                    if (req.DeviceIDs && req.DeviceIDs.length > 0) {
                        gpus.push(...req.DeviceIDs);
                    }
                    else if (req.Count === -1) {
                        gpus.push('all');
                    }
                    else if (req.Count) {
                        gpus.push(String(req.Count));
                    }
                }
            }
            inspectCache.set(containerId, { gpus, expiry: Date.now() + INSPECT_TTL_MS });
            return gpus;
        }
        catch {
            return [];
        }
    });
}
export function sampleDockerApi() {
    return __awaiter(this, void 0, void 0, function* () {
        const containers = yield docker.listContainers({ all: false });
        if (containers.length === 0)
            return [];
        const settled = yield Promise.allSettled(containers.map((c) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e;
            const instance = docker.getContainer(c.Id);
            const [statsRaw, gpus] = yield Promise.all([
                instance.stats({ stream: false }),
                getGpuBindings(c.Id),
            ]);
            const memUsed = (_a = statsRaw.memory_stats.usage) !== null && _a !== void 0 ? _a : 0;
            const memLimit = (_b = statsRaw.memory_stats.limit) !== null && _b !== void 0 ? _b : 0;
            const memUsage = `${formatBytes(memUsed)} / ${formatBytes(memLimit)}`;
            const cpuPercent = calcCpuPercent(statsRaw);
            const ports = c.Ports.map((p) => {
                if (p.PublicPort)
                    return `${p.PublicPort}->${p.PrivatePort}/${p.Type}`;
                return `${p.PrivatePort}/${p.Type}`;
            }).join(', ');
            const publishedPort = (_c = c.Ports.find((p) => p.PublicPort)) === null || _c === void 0 ? void 0 : _c.PublicPort;
            return {
                id: c.Id.slice(0, 12),
                name: (_e = (_d = c.Names[0]) === null || _d === void 0 ? void 0 : _d.replace(/^\//, '')) !== null && _e !== void 0 ? _e : c.Id.slice(0, 12),
                image: c.Image,
                status: c.Status,
                ports,
                publishedPort: publishedPort ? String(publishedPort) : null,
                cpuPercent,
                memUsage,
                memUsedRaw: memUsed,
                gpus,
            };
        })));
        const metrics = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
        // Preserve the last good snapshot when Docker is temporarily unhealthy.
        if (metrics.length === 0) {
            throw new Error('Docker API sampling failed for all running containers');
        }
        return metrics;
    });
}
