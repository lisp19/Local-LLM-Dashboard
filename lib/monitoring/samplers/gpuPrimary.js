var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
const execFileAsync = promisify(execFile);
function findBinary(name_1) {
    return __awaiter(this, arguments, void 0, function* (name, extraPaths = []) {
        const paths = [...extraPaths, '/usr/local/bin', '/usr/bin', '/bin'];
        for (const p of paths) {
            const fullPath = path.join(p, name);
            try {
                yield fs.access(fullPath);
                return fullPath;
            }
            catch (_a) {
                // continue
            }
        }
        return name;
    });
}
function sampleNvidia() {
    return __awaiter(this, void 0, void 0, function* () {
        const nvidiaSmi = yield findBinary('nvidia-smi');
        const { stdout } = yield execFileAsync(nvidiaSmi, [
            '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed',
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
                utilization: parts[2] ? `${parts[2]}%` : '0%',
                memoryUsed: parts[3] ? `${parts[3]} MiB` : '0 MiB',
                memoryTotal: parts[4] ? `${parts[4]} MiB` : '0 MiB',
                temperature: parts[5] ? `${parts[5]} °C` : '-',
                powerDraw: parts[6] ? `${Math.round(parseFloat(parts[6]))}` : '0',
                powerLimit: parts[7] ? `${Math.round(parseFloat(parts[7]))}` : '0',
                fanSpeed: parts[8] && parts[8] !== 'N/A' ? `${parts[8]}%` : '-',
            };
        })
            .filter((g) => g.id);
    });
}
function sampleAmd() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const rocmSmi = yield findBinary('rocm-smi', ['/opt/rocm/bin']);
        const [{ stdout: rocmStdout }, { stdout: memStdout }] = yield Promise.all([
            execFileAsync(rocmSmi, ['-a', '--json']),
            execFileAsync(rocmSmi, ['--showmeminfo', 'vram', '--json']),
        ]);
        const rocmData = JSON.parse(rocmStdout);
        const memData = JSON.parse(memStdout);
        const gpus = [];
        for (const key of Object.keys(rocmData)) {
            if (!key.startsWith('card'))
                continue;
            const id = key.replace('card', '');
            const gpu = (_a = rocmData[key]) !== null && _a !== void 0 ? _a : {};
            const mem = (_b = memData[key]) !== null && _b !== void 0 ? _b : {};
            gpus.push({
                id,
                name: (_d = (_c = gpu['Device Name']) !== null && _c !== void 0 ? _c : gpu['Card Series']) !== null && _d !== void 0 ? _d : `AMD GPU ${id}`,
                type: 'AMD',
                utilization: gpu['GPU use (%)'] ? `${gpu['GPU use (%)']}%` : '0%',
                memoryUsed: mem['VRAM Total Used Memory (B)']
                    ? `${Math.round(parseInt(mem['VRAM Total Used Memory (B)'], 10) / 1024 / 1024)} MiB`
                    : '0 MiB',
                memoryTotal: mem['VRAM Total Memory (B)']
                    ? `${Math.round(parseInt(mem['VRAM Total Memory (B)'], 10) / 1024 / 1024)} MiB`
                    : '0 MiB',
                temperature: gpu['Temperature (Sensor edge) (C)'] ? `${gpu['Temperature (Sensor edge) (C)']} °C` : '-',
                powerDraw: gpu['Current Socket Graphics Package Power (W)']
                    ? `${Math.round(parseFloat(gpu['Current Socket Graphics Package Power (W)']))}`
                    : '0',
                powerLimit: gpu['Max Graphics Package Power (W)']
                    ? `${Math.round(parseFloat(gpu['Max Graphics Package Power (W)']))}`
                    : '0',
                fanSpeed: gpu['Fan speed (%)'] ? `${gpu['Fan speed (%)']}%` : '-',
            });
        }
        return gpus;
    });
}
export function sampleGpuPrimary() {
    return __awaiter(this, void 0, void 0, function* () {
        const results = [];
        const [nvidiaResult, amdResult] = yield Promise.allSettled([sampleNvidia(), sampleAmd()]);
        if (nvidiaResult.status === 'fulfilled')
            results.push(...nvidiaResult.value);
        if (amdResult.status === 'fulfilled')
            results.push(...amdResult.value);
        return results;
    });
}
