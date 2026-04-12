import { logger } from '#/infra/logger/appLogger';
import { setSamplerParam } from '../../repositories/samplerBridge';
import { samplerStore } from '../../stores/samplerStore';

export function setSamplerParamImmediate(param: string, value: number): void {
    const state = samplerStore.value;
    if (!state?.instanceId) return;
    setSamplerParam(state.instanceId, param, value).catch((err) => {
        logger.warn('Failed to set sampler param:', err);
    });
}