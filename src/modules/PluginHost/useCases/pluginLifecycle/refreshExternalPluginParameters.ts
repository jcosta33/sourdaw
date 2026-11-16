import { logger } from '#/infra/logger/appLogger';

import { getPluginParameters } from '../../repositories/pluginBridge/getPluginParameters';
import {
    type ExternalPluginParameter,
    issueExternalPluginParameterRead,
    publishExternalPluginParameterRead,
} from '../../stores/externalPluginParameterStore';

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
 * A re-read never displaces anything newer than its issue: an edit that lands
 * while the host answers keeps its value, and an answer superseded by a newer
 * re-read of the same instance is dropped. Resolves to the parameter objects it
 * put in the store, so a caller can tell them from an edit's; empty when the
 * read failed, was superseded, or the instance is gone.
 *
 * Never throws: a refusal from the host leaves the existing snapshot standing,
 * because stale metadata is a better answer for the menu than none.
 */
export async function refreshExternalPluginParameters(instanceId: string): Promise<readonly ExternalPluginParameter[]> {
    if (!loadedExternalInstances.has(instanceId)) {
        return [];
    }
    const ticket = issueExternalPluginParameterRead(instanceId);
    try {
        const hostParameters = toExternalPluginParameters(await getPluginParameters(instanceId));
        return publishExternalPluginParameterRead(instanceId, ticket, hostParameters);
    } catch (error) {
        logger.warn(`Failed to read parameters for external plugin instance ${instanceId}: ${String(error)}`);
        return [];
    }
}
