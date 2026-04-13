var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { if (result.done) { resolve(result.value); } else { adopt(result.value).then(fulfilled, rejected); } }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { MONITOR_TOPICS } from '../topics';
import { randomUUID } from 'crypto';
function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
        promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}
export function createDispatcher(deps) {
    const { name, topic, metricKey, config, sourceId, agentId, primary, fallback, publish, publishHealth } = deps;
    const state = {
        name,
        mode: 'primary',
        health: 'healthy',
        consecutivePrimaryFailures: 0,
        consecutiveFallbackFailures: 0,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        lastLatencyMs: null,
        intervalMs: config.intervalMs,
    };
    let timer = null;
    let probeTimer = null;
    let running = false;
    let errorCount = 0;
    function buildEnvelope(payload, mode, latencyMs) {
        return {
            id: randomUUID(),
            topic,
            metricKey,
            sourceId,
            agentId,
            producerId: name,
            timestamp: Date.now(),
            payload,
            meta: {
                mode,
                latencyMs,
                sampleWindowMs: config.intervalMs,
                degraded: state.health === 'degraded',
                errorCount,
                schemaVersion: 1,
            },
        };
    }
    function runCycle() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            if (!config.enabled)
                return;
            const start = Date.now();
            // In degraded mode, run fallback directly (probe is separate)
            if (state.health === 'degraded') {
                try {
                    const payload = yield withTimeout(fallback(), config.timeoutMs);
                    const latencyMs = Date.now() - start;
                    state.lastSuccessAt = Date.now();
                    state.lastLatencyMs = latencyMs;
                    state.consecutiveFallbackFailures = 0;
                    publish(buildEnvelope(payload, 'fallback', latencyMs));
                    publishHealth(state);
                }
                catch (err) {
                    state.lastErrorAt = Date.now();
                    state.lastErrorMessage = err instanceof Error ? err.message : String(err);
                    state.consecutiveFallbackFailures++;
                    errorCount++;
                    if (state.consecutiveFallbackFailures >= config.degradeAfterFailures) {
                        state.health = 'failed';
                        publishHealth(state, 'error', (_a = state.lastErrorMessage) !== null && _a !== void 0 ? _a : undefined);
                    }
                    else {
                        publishHealth(state, 'error', (_b = state.lastErrorMessage) !== null && _b !== void 0 ? _b : undefined);
                    }
                }
                return;
            }
            // Normal mode: try primary, then fallback
            let primaryError = null;
            let payload = null;
            let usedMode = 'primary';
            try {
                payload = yield withTimeout(primary(), config.timeoutMs);
                const latencyMs = Date.now() - start;
                state.consecutivePrimaryFailures = 0;
                state.lastSuccessAt = Date.now();
                state.lastLatencyMs = latencyMs;
                publish(buildEnvelope(payload, 'primary', latencyMs));
                publishHealth(state);
                return;
            }
            catch (err) {
                primaryError = err instanceof Error ? err : new Error(String(err));
                state.consecutivePrimaryFailures++;
                errorCount++;
            }
            // Try fallback
            try {
                payload = yield withTimeout(fallback(), config.timeoutMs);
                usedMode = 'fallback';
                const latencyMs = Date.now() - start;
                state.lastSuccessAt = Date.now();
                state.lastLatencyMs = latencyMs;
                state.consecutiveFallbackFailures = 0;
                publish(buildEnvelope(payload, usedMode, latencyMs));
                // Check if we need to enter degraded mode
                if (state.consecutivePrimaryFailures >= config.degradeAfterFailures) {
                    state.health = 'degraded';
                    state.mode = 'fallback';
                    publishHealth(state, 'degraded', `Primary failed ${state.consecutivePrimaryFailures} times, entering degraded mode`);
                }
                else {
                    publishHealth(state, 'error', (_c = primaryError === null || primaryError === void 0 ? void 0 : primaryError.message) !== null && _c !== void 0 ? _c : 'Primary failed');
                }
            }
            catch (fallbackErr) {
                state.lastErrorAt = Date.now();
                state.lastErrorMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
                state.consecutiveFallbackFailures++;
                errorCount++;
                publishHealth(state, 'error', `Primary: ${(_d = primaryError === null || primaryError === void 0 ? void 0 : primaryError.message) !== null && _d !== void 0 ? _d : '?'}, Fallback: ${state.lastErrorMessage}`);
            }
        });
    }
    function probeRecovery() {
        return __awaiter(this, void 0, void 0, function* () {
            if (state.health !== 'degraded' || !running)
                return;
            try {
                const payload = yield withTimeout(primary(), config.timeoutMs);
                const latencyMs = Date.now() - Date.now();
                state.consecutivePrimaryFailures = 0;
                state.lastSuccessAt = Date.now();
                state.lastLatencyMs = latencyMs;
                // Check if enough consecutive successes to recover
                // We use a simple counter by leveraging consecutivePrimaryFailures = 0 means success
                const prevHealth = state.health;
                if (prevHealth === 'degraded') {
                    state.health = 'healthy';
                    state.mode = 'primary';
                    publishHealth(state, 'recovered', 'Primary sampler recovered');
                    publish(buildEnvelope(payload, 'primary', latencyMs));
                }
            }
            catch {
                // Still not recovered, keep degraded
            }
        });
    }
    function scheduleNext() {
        if (!running)
            return;
        timer = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
            yield runCycle();
            scheduleNext();
        }), config.intervalMs);
    }
    function scheduleProbe() {
        if (!running)
            return;
        probeTimer = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
            if (state.health === 'degraded') {
                yield probeRecovery();
            }
            scheduleProbe();
        }), config.apiProbeIntervalMs);
    }
    return {
        start() {
            if (running)
                return;
            running = true;
            // Kick off immediate first run
            runCycle().then(() => scheduleNext()).catch(() => scheduleNext());
            scheduleProbe();
        },
        stop() {
            return __awaiter(this, void 0, void 0, function* () {
                running = false;
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                if (probeTimer) {
                    clearTimeout(probeTimer);
                    probeTimer = null;
                }
            });
        },
        getState() {
            return Object.assign({}, state);
        },
    };
}
export function makePublishHealth(publish, sourceId, agentId) {
    return (state, eventType, message) => {
        var _a;
        publish({
            id: randomUUID(),
            topic: MONITOR_TOPICS.healthDispatcher,
            metricKey: 'dispatcher.state',
            sourceId,
            agentId,
            producerId: state.name,
            timestamp: Date.now(),
            sequence: 0,
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
    };
}
