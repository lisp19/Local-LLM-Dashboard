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
import * as path from 'path';
import * as fs from 'fs/promises';
const execFileAsync = promisify(execFile);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function findBinary(name_1) {
    return __awaiter(this, arguments, void 0, function* (name, extraPaths = []) {
        const paths = [...extraPaths, '/usr/local/bin', '/usr/bin', '/bin'];
        for (const p of paths) {
            const fullPath = path.join(p, name);
            try {
                yield fs.access(fullPath);
                return fullPath;
            }
            catch {
                // continue
            }
        }
        return name;
    });
}
// Fallback uses narrower/simpler queries that are more compatible
function sampleNvidiaFallback() {
    return __awaiter(this, void 0, void 0, function* () {
        const nvidiaSmi = yield findBinary('nvidia-smi');
        const { stdout } = yield execFileAsync(nvidiaSmi, [
            '--query-gpu=index,name,memory.total,memory.used',
            '--format=csv,noheader,nounits',
        ]);
        const lines = stdout.trim().split('\n');
        return lines
            .map((line) => {
            var _a, _b;
            const parts = line.split(',').map((s) => s.trim());
            return {
                id: (_a = parts[0]) !== null && _a !== void 0 ? _a : '',
                name: (_b = parts[1]) !== null && _b !== void 0 ? _b : '',
                type: 'Nvidia',
                utilization: '-',
                memoryUsed: parts[3] ? `${parts[3]} MiB` : '0 MiB',
                memoryTotal: parts[2] ? `${parts[2]} MiB` : '0 MiB',
                temperature: '-',
                powerDraw: '-',
                powerLimit: '-',
                fanSpeed: '-',
            };
        })
            .filter((g) => g.id);
    });
}
function sampleAmdFallback() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const rocmSmi = yield findBinary('rocm-smi', ['/opt/rocm/bin']);
        const { stdout: memStdout } = yield execFileAsync(rocmSmi, ['--showmeminfo', 'vram', '--json']);
        const memData = JSON.parse(memStdout);
        const gpus = [];
        for (const key of Object.keys(memData)) {
            if (!key.startsWith('card'))
                continue;
            const id = key.replace('card', '');
            const mem = (_a = memData[key]) !== null && _a !== void 0 ? _a : {};
            gpus.push({
                id,
                name: `AMD GPU ${id}`,
                type: 'AMD',
                utilization: '-',
                memoryUsed: mem['VRAM Total Used Memory (B)']
                    ? `${Math.round(parseInt(mem['VRAM Total Used Memory (B)'], 10) / 1024 / 1024)} MiB`
                    : '0 MiB',
                memoryTotal: mem['VRAM Total Memory (B)']
                    ? `${Math.round(parseInt(mem['VRAM Total Memory (B)'], 10) / 1024 / 1024)} MiB`
                    : '0 MiB',
                temperature: '-',
                powerDraw: '-',
                powerLimit: '-',
                fanSpeed: '-',
            });
        }
        return gpus;
    });
}
export function sampleGpuFallback() {
    return __awaiter(this, void 0, void 0, function* () {
        const results = [];
        const [nvidiaResult, amdResult] = yield Promise.allSettled([sampleNvidiaFallback(), sampleAmdFallback()]);
        if (nvidiaResult.status === 'fulfilled')
            results.push(...nvidiaResult.value);
        if (amdResult.status === 'fulfilled')
            results.push(...amdResult.value);
        return results;
    });
}
