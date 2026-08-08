import { crumbsParamCacheKey, flushCrumbsParam, paramBatcher } from './helpers';

export function setCrumbsParamThrottled(instanceId: string, param: string, value: number): void {
    paramBatcher.schedule(crumbsParamCacheKey(instanceId, param), { instanceId, param, value }, flushCrumbsParam);
}
