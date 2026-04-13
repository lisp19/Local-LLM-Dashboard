var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as os from 'os';
import * as fs from 'fs/promises';
// Fallback: read /proc/stat and /proc/meminfo directly
function getCpuUsageFromProc() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const stat = yield fs.readFile('/proc/stat', 'utf-8');
            const line = stat.split('\n')[0];
            const parts = line.split(/\s+/).slice(1).map(Number);
            const idle = (_a = parts[3]) !== null && _a !== void 0 ? _a : 0;
            const total = parts.reduce((a, b) => a + b, 0);
            return total === 0 ? 0 : Math.round((1 - idle / total) * 10000) / 100;
        }
        catch (_b) {
            return 0;
        }
    });
}
function getMemFromProc() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const content = yield fs.readFile('/proc/meminfo', 'utf-8');
            const lines = content.split('\n');
            const get = (key) => {
                var _a;
                const match = lines.find((l) => l.startsWith(key + ':'));
                return match ? parseInt((_a = match.split(/\s+/)[1]) !== null && _a !== void 0 ? _a : '0', 10) * 1024 : 0;
            };
            return { total: get('MemTotal'), free: get('MemAvailable') };
        }
        catch (_a) {
            return { total: os.totalmem(), free: os.freemem() };
        }
    });
}
function getOsReleaseFallback() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const content = yield fs.readFile('/etc/os-release', 'utf-8');
            const match = content.match(/PRETTY_NAME="(.+)"/);
            if (match)
                return match[1];
        }
        catch (_a) {
            // fall through
        }
        return `${os.type()} ${os.release()}`;
    });
}
export function sampleSystemFallback() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const [cpuUsage, { total: totalMem, free: freeMem }, osRelease] = yield Promise.all([
            getCpuUsageFromProc(),
            getMemFromProc(),
            getOsReleaseFallback(),
        ]);
        const cpus = os.cpus();
        return {
            cpuUsage,
            cpuCores: cpus.length,
            cpuModel: (_b = (_a = cpus[0]) === null || _a === void 0 ? void 0 : _a.model) !== null && _b !== void 0 ? _b : 'Unknown CPU',
            osRelease,
            memory: {
                total: totalMem,
                used: totalMem - freeMem,
                free: freeMem,
            },
        };
    });
}
