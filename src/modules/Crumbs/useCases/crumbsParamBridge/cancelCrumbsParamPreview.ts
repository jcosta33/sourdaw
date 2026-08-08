import { crumbsParamCacheKey, paramBatcher } from './helpers';

/**
 * Drop any rAF-batched preview still pending for one parameter of one device.
 *
 * Called on commit. The last pointer-move of a drag schedules a flush for the next
 * animation frame, which lands *after* the release has already committed; without
 * this the backend would be left holding a value the commit had superseded.
 */
export function cancelCrumbsParamPreview(instanceId: string, param: string): void {
    paramBatcher.cancel(crumbsParamCacheKey(instanceId, param));
}
