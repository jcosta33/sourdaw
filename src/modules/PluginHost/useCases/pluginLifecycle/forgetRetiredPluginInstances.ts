/**
 * Forget the instances a native engine retire destroyed (#3960).
 *
 * A retire drops the whole scheduler, and the engine-owned plugin records go
 * with it; the ids come back on `retiredInstanceIds`. Nothing on the native
 * side ever reports them again, and `activateExternalPlugin` short-circuits on
 * `loadedExternalInstances`, so without this forget the next `ensureTrackStrips`
 * projection would read a destroyed instance as live and never reload it.
 *
 * An id this process does not hold is ignored: the caller passes on whatever
 * the engine drained, and only the ids this generation actually loaded have a
 * record here to drop.
 */

import { forgetPluginInstance } from './forgetPluginInstance';
import { loadedExternalInstances } from './loadedExternalInstances';

export function forgetRetiredPluginInstances(instanceIds: readonly string[]): void {
    for (const instanceId of instanceIds) {
        if (!loadedExternalInstances.has(instanceId)) {
            continue;
        }
        forgetPluginInstance(instanceId);
    }
}
