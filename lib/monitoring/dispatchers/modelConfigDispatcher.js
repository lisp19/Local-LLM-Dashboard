var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createDispatcher, makePublishHealth } from './createDispatcher';
import { MONITOR_TOPICS } from '../topics';
import { sampleModelConfigPrimary } from '../samplers/modelConfigPrimary';
import { sampleModelConfigFallback, updateModelConfigFallbackCache } from '../samplers/modelConfigFallback';
export function createModelConfigDispatcher(deps) {
    function primary() {
        return __awaiter(this, void 0, void 0, function* () {
            const config = yield sampleModelConfigPrimary();
            updateModelConfigFallbackCache(config);
            return config;
        });
    }
    return createDispatcher({
        name: 'model-config-dispatcher',
        topic: MONITOR_TOPICS.configModel,
        metricKey: 'config.model',
        config: deps.config.dispatchers.modelConfig,
        sourceId: deps.sourceId,
        agentId: deps.agentId,
        primary,
        fallback: sampleModelConfigFallback,
        publish: deps.publish,
        publishHealth: makePublishHealth(deps.publish, deps.sourceId, deps.agentId),
    });
}
