import { logger } from '#/infra/logger/appLogger';
import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { setCrumbsParam } from '../../repositories/crumbsBridge';

// §57.1 — Shared rAF-batch primitive (same as the 6 plugin bridges).
type CrumbsBatchEntry = { instanceId: string; param: string; value: number };
const paramBatcher = createRafBatcher<CrumbsBatchEntry>();

function flushCrumbsParam(_cacheKey: string, entry: CrumbsBatchEntry): void {
    setCrumbsParam(entry.instanceId, entry.param, entry.value).catch((error) => {
        logger.warn('Failed to set crumbs param:', error);
    });
}

export function setCrumbsParamThrottled(instanceId: string, param: string, value: number): void {
    const cacheKey = `${instanceId}_${param}`;
    paramBatcher.schedule(cacheKey, { instanceId, param, value }, flushCrumbsParam);
}
