var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { if (result.done) { resolve(result.value); } else { adopt(result.value).then(fulfilled, rejected); } }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
function parseMemBytes(memStr) {
    var _a;
    if (!memStr)
        return 0;
    const usedPart = memStr.split('/')[0].trim();
    const match = usedPart.match(/^([0-9.]+)\s*([a-zA-Z]*)$/);
    if (!match)
        return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    const units = {
        b: 1,
        kib: 1024,
        mib: 1024 * 1024,
        gib: 1024 * 1024 * 1024,
        tib: 1024 * 1024 * 1024 * 1024,
        kb: 1000,
        mb: 1000 * 1000,
        gb: 1000 * 1000 * 1000,
        tb: 1000 * 1000 * 1000 * 1000,
    };
    return value * ((_a = units[unit]) !== null && _a !== void 0 ? _a : 1);
}
function extractPublishedPort(ports) {
    if (!ports)
        return null;
    const mappings = ports.split(',').map((part) => part.trim()).filter(Boolean);
    for (const mapping of mappings) {
        const directMatch = mapping.match(/^(\d+)->\d+\//);
        if (directMatch)
            return directMatch[1];
        const hostMatch = mapping.match(/:(\d+)->/);
        if (hostMatch)
            return hostMatch[1];
    }
    return null;
}
export function sampleDockerCli() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
        const { stdout: psStdout } = yield execFileAsync('docker', ['ps', '--format', '{{json .}}']);
        if (!psStdout.trim())
            return [];
        const containers = psStdout.trim().split('\n').map((line) => JSON.parse(line));
        const { stdout: statsStdout } = yield execFileAsync('docker', [
            'stats',
            '--no-stream',
            '--format',
            '{{json .}}',
        ]);
        const statsMap = new Map();
        for (const line of statsStdout.trim().split('\n').filter(Boolean)) {
            const stat = JSON.parse(line);
            statsMap.set(stat.ID, stat);
        }
        const metrics = [];
        for (const c of containers) {
            const containerId = ((_b = (_a = c.ID) !== null && _a !== void 0 ? _a : c.Id) !== null && _b !== void 0 ? _b : '');
            const stat = (_c = statsMap.get(containerId)) !== null && _c !== void 0 ? _c : {};
            const gpus = [];
            try {
                const { stdout: inspectOut } = yield execFileAsync('docker', ['inspect', containerId]);
                const inspectData = JSON.parse(inspectOut);
                const deviceRequests = (_f = (_e = (_d = inspectData[0]) === null || _d === void 0 ? void 0 : _d.HostConfig) === null || _e === void 0 ? void 0 : _e.DeviceRequests) !== null && _f !== void 0 ? _f : [];
                for (const req of deviceRequests) {
                    if ((_g = req.Capabilities) === null || _g === void 0 ? void 0 : _g.some((cap) => cap.includes('gpu'))) {
                        if (((_h = req.DeviceIDs) === null || _h === void 0 ? void 0 : _h.length) > 0) {
                            gpus.push(...req.DeviceIDs);
                        }
                        else if (req.Count === -1) {
                            gpus.push('all');
                        }
                        else {
                            gpus.push(String(req.Count));
                        }
                    }
                }
            }
            catch {
                // Ignore inspect errors for one container; keep the runtime metrics snapshot.
            }
            metrics.push({
                id: containerId,
                name: ((_k = (_j = c.Names) !== null && _j !== void 0 ? _j : c.Name) !== null && _k !== void 0 ? _k : containerId),
                image: ((_l = c.Image) !== null && _l !== void 0 ? _l : ''),
                status: ((_m = c.Status) !== null && _m !== void 0 ? _m : ''),
                ports: ((_o = c.Ports) !== null && _o !== void 0 ? _o : ''),
                publishedPort: extractPublishedPort(((_p = c.Ports) !== null && _p !== void 0 ? _p : '')),
                cpuPercent: ((_q = stat.CPUPerc) !== null && _q !== void 0 ? _q : '0.00%'),
                memUsage: ((_r = stat.MemUsage) !== null && _r !== void 0 ? _r : '0B / 0B'),
                memUsedRaw: parseMemBytes(((_s = stat.MemUsage) !== null && _s !== void 0 ? _s : '0B / 0B')),
                gpus,
            });
        }
        return metrics;
    });
}
