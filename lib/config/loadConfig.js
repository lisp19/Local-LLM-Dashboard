var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { if (result.done) { resolve(result.value); } else { adopt(result.value).then(fulfilled, rejected); } }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
const DEFAULT_CONFIG = {
    openWebUIPort: 53000,
    vllmApiKey: 'vllm-test',
    pythonPath: '~/miniconda3/envs/kt/bin/python',
    benchmarkPlotDir: '~/.config/kanban/benchmarks',
    dispatchers: {
        system: { enabled: true, intervalMs: 1000, timeoutMs: 1000, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5000 },
        docker: { enabled: true, intervalMs: 1500, timeoutMs: 5000, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5000 },
        gpu: { enabled: true, intervalMs: 1500, timeoutMs: 2000, degradeAfterFailures: 3, recoverAfterSuccesses: 2, apiProbeIntervalMs: 5000 },
        modelConfig: { enabled: true, intervalMs: 5000, timeoutMs: 1000, degradeAfterFailures: 2, recoverAfterSuccesses: 1, apiProbeIntervalMs: 10000 },
    },
    agent: {
        allowExternalReport: true,
        reportToken: 'change-me',
    },
    snapshot: {
        maxAgeMs: 5000,
    },
    health: {
        retentionLimit: 200,
    },
};
function getConfigCandidateDirs() {
    return [
        path.join(os.homedir(), '.config', 'kanban'),
        process.cwd(),
    ];
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function mergeDeep(base, override) {
    var _a;
    if (!isRecord(base) || !isRecord(override)) {
        return (_a = override) !== null && _a !== void 0 ? _a : base;
    }
    const result = Object.assign({}, base);
    for (const [key, value] of Object.entries(override)) {
        const current = result[key];
        result[key] = isRecord(current) && isRecord(value) ? mergeDeep(current, value) : value;
    }
    return result;
}
export function loadMonitoringConfig() {
    return __awaiter(this, void 0, void 0, function* () {
        for (const dir of getConfigCandidateDirs()) {
            const configPath = path.join(dir, 'config.json');
            try {
                const content = yield fs.readFile(configPath, 'utf8');
                return mergeDeep(DEFAULT_CONFIG, JSON.parse(content));
            }
            catch {
                continue;
            }
        }
        return Object.assign({}, DEFAULT_CONFIG);
    });
}
export function loadModelConfig() {
    return __awaiter(this, void 0, void 0, function* () {
        for (const dir of getConfigCandidateDirs()) {
            const configPath = path.join(dir, 'model-config.json');
            try {
                const content = yield fs.readFile(configPath, 'utf8');
                return JSON.parse(content);
            }
            catch {
                continue;
            }
        }
        return {};
    });
}
