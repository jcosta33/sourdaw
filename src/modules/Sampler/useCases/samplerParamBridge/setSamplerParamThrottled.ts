import { logger } from '#/infra/logger/appLogger';
import { setSamplerParam } from '../../repositories/samplerBridge';

const pending = new Map<string, number>();
const latest = new Map<string, { param: string; value: number }>();

function flushSamplerParam(cacheKey: string, instanceId: string): void {
    pending.delete(cacheKey);
    const entry = latest.get(cacheKey);
    if (!entry) {return;}
    latest.delete(cacheKey);
    setSamplerParam(instanceId, entry.param, entry.value).catch((err) => {
        logger.warn('Failed to set sampler param:', err);
    });
}

export function setSamplerParamThrottled(instanceId: string, param: string, value: number): void {
    const cacheKey = `${instanceId}_${param}`;
    latest.set(cacheKey, { param, value });
    if (!pending.has(cacheKey)) {
        pending.set(cacheKey, requestAnimationFrame(() => flushSamplerParam(cacheKey, instanceId)));
    }
}