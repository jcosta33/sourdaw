import { logger } from '#/infra/logger/appLogger';

import { readPluginTails } from '../../repositories/pluginBridge/readPluginTails';
import { reviseExternalPluginTail } from '../../stores/externalPluginTailStore';

import { loadedExternalInstances } from './loadedExternalInstances';

/**
 * Re-read every loaded external plugin instance's tail from the native host and
 * revise `externalPluginTailStore` with the answers.
 *
 * CLAP pushes a revised tail through `plugin-tail-changed`; VST3 has no such
 * notification, so a reverb switched to a longer preset after load would keep
 * its load-time figure. A caller that is about to size something from the tail
 * — an export — asks here first.
 *
 * An instance unloaded while the host answers is not revived: the revision lands
 * only on an instance the store still holds. An instance the host could not read
 * keeps the figure it had. Never throws: a refused read leaves every stored tail
 * as it was, because a stale tail is a better answer than none.
 */
export async function refreshExternalPluginTails(): Promise<void> {
    if (loadedExternalInstances.size === 0) {
        return;
    }
    try {
        const readings = await readPluginTails([...loadedExternalInstances]);
        for (const { instance_id: instanceId, tail_samples: tailSamples } of readings) {
            if (loadedExternalInstances.has(instanceId)) {
                reviseExternalPluginTail(instanceId, tailSamples);
            }
        }
    } catch (error) {
        logger.warn(`Failed to re-read external plugin tails: ${String(error)}`);
    }
}
