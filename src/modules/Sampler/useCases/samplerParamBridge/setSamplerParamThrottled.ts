import { logger } from '#/infra/logger/appLogger';
import { createRafBatcher } from '#/utils/DOM/createRafBatcher';
import { setSamplerParam } from '../../repositories/samplerBridge';

// §57.1 — Shared rAF-batch primitive (same as the 6 plugin bridges).
type SamplerBatchEntry = { instanceId: string; param: string; value: number };
const paramBatcher = createRafBatcher<SamplerBatchEntry>();

function flushSamplerParam(_cacheKey: string, entry: SamplerBatchEntry): void {
    setSamplerParam(entry.instanceId, entry.param, entry.value).catch((err) => {
        logger.warn('Failed to set sampler param:', err);
    });
}

export function setSamplerParamThrottled(instanceId: string, param: string, value: number): void {
    const cacheKey = `${instanceId}_${param}`;
    paramBatcher.schedule(cacheKey, { instanceId, param, value }, flushSamplerParam);
}