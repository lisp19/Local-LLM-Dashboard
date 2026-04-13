var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { if (result.done) { resolve(result.value); } else { adopt(result.value).then(fulfilled, rejected); } }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { loadAppConfig } from '../../appConfig';
export function assertAgentToken(token) {
    return __awaiter(this, void 0, void 0, function* () {
        const config = yield loadAppConfig();
        if (!config.agent.allowExternalReport)
            throw new Error('External agent reporting disabled');
        if (!token || token !== config.agent.reportToken)
            throw new Error('Invalid agent token');
    });
}
