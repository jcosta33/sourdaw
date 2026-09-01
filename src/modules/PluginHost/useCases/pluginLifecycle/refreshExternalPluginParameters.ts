import { logger } from '#/infra/logger/appLogger';

import { getPluginParameters } from '../../repositories/pluginBridge/getPluginParameters';
import { patchExternalPluginParameters } from '../../stores/externalPluginParameterStore';

import { loadedExternalInstances } from './loadedExternalInstances';
import { toExternalPluginParameters } from './toExternalPluginParameters';

/**
 * Re-read one loaded external plugin instance's parameter metadata from the
 * native host and publish it to `externalPluginParameterStore`.
 *
 * Activation seeds the snapshot from the instance it loaded; this exists because
 * that snapshot goes stale. A plugin renames, rescales or re-declares its
 * parameters after a preset load or an edit in its own editor window, and the
 * automation menu would otherwise keep offering the names and ranges the plugin
 * had at load time.
 *
 * Never throws: a refusal from the host leaves the existing snapshot standing,
 * because stale metadata is a better answer for the menu than none.
 */
export async function refreshExternalPluginParameters(instanceId: string): Promise<void> {
    if (!loadedExternalInstances.has(instanceId)) {
        return;
    }
    try {
        patchExternalPluginParameters(instanceId, toExternalPluginParameters(await getPluginParameters(instanceId)));
    } catch (error) {
        logger.warn(`Failed to read parameters for external plugin instance ${instanceId}: ${String(error)}`);
    }
}
