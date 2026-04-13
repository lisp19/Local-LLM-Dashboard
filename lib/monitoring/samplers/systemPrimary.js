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
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
// Track CPU times between samples for usage calculation
let lastCpuTimes = null;
function computeCpuUsage() {
    var _a;
    const cpus = os.cpus();
    if (!lastCpuTimes) {
        lastCpuTimes = cpus.map((c) => (Object.assign({}, c.times)));
        return 0;
    }
    let totalDiff = 0;
    let idleDiff = 0;
    for (let i = 0; i < cpus.length; i++) {
        const curr = cpus[i].times;
        const last = (_a = lastCpuTimes[i]) !== null && _a !== void 0 ? _a : curr;
        const user = curr.user - last.user;
        const nice = curr.nice - last.nice;
        const sys = curr.sys - last.sys;
        const idle = curr.idle - last.idle;
        const irq = curr.irq - last.irq;
        const total = user + nice + sys + idle + irq;
        totalDiff += total;
        idleDiff += idle;
    }
    lastCpuTimes = cpus.map((c) => (Object.assign({}, c.times)));
    return totalDiff === 0 ? 0 : Math.round((100 - (100 * idleDiff) / totalDiff) * 100) / 100;
}
function getOsRelease() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { stdout } = yield execFileAsync('lsb_release', ['-ds']);
            if (stdout.trim())
                return stdout.trim();
        }
        catch (_a) {
            // fall through
        }
        try {
            const content = yield fs.readFile('/etc/os-release', 'utf-8');
            const match = content.match(/PRETTY_NAME="(.+)"/);
            if (match)
                return match[1];
        }
        catch (_b) {
            // fall through
        }
        return `${os.type()} ${os.release()}`;
    });
}
export function sampleSystemPrimary() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const cpuUsage = computeCpuUsage();
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const osRelease = yield getOsRelease();
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
