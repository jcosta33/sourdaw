import { logger } from '#/infra/logger/appLogger';

import { formatPluginParameterValue } from '../../repositories/pluginBridge/formatPluginParameterValue';

/**
 * Ask the plugin for its own text for `value` of one parameter of a loaded
 * instance. Resolves to `null` when the plugin offers no text or the host could
 * not be asked.
 *
 * Never throws: a missing text falls back to the plain number in the caller,
 * so a refusal is logged and answered as no text.
 */
export async function formatExternalPluginParameterValue(
    instanceId: string,
    paramId: number,
    value: number
): Promise<string | null> {
    try {
        return await formatPluginParameterValue(instanceId, paramId, value);
    } catch (error) {
        logger.warn(
            `Failed to format parameter ${String(paramId)} of external plugin instance ${instanceId}: ${String(error)}`
        );
        return null;
    }
}
