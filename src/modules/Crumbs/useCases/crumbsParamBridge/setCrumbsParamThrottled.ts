import { logger } from '#/infra/logger/appLogger';

import { setCrumbsParam } from '../../repositories/crumbsBridge/setCrumbsParam';

import { crumbsParamCacheKey, paramBatcher, type CrumbsBatchEntry } from './helpers';

function flushCrumbsParam(_cacheKey: string, entry: CrumbsBatchEntry): void {
    setCrumbsParam(entry.instanceId, entry.param, entry.value).catch((error) => {
        logger.warn('Failed to set crumbs param:', error);
    });
}

export function setCrumbsParamThrottled(instanceId: string, param: string, value: number): void {
    paramBatcher.schedule(crumbsParamCacheKey(instanceId, param), { instanceId, param, value }, flushCrumbsParam);
}
