import { logger } from '#/infra/logger/appLogger';

import { readPluginTails } from '../../repositories/pluginBridge/readPluginTails';
import { issueExternalPluginTailRead, publishExternalPluginTailRead } from '../../stores/externalPluginTailStore';

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
 * An answer lands only if nothing has written that instance's tail since the read
 * was issued (an unload and any reload under the same id, or a
 * `plugin-tail-changed` revision), and no refresh issued after this one has
 * already published for it. Refreshes are ordered by when they were issued, not
 * by which answers first, and one answer never invalidates another. An instance
 * the host could not read keeps the figure it had.
 *
 * Never throws: a refused read leaves every stored tail as it was, because a
 * stale tail is a better answer than none.
 */
export async function refreshExternalPluginTails(): Promise<void> {
    if (loadedExternalInstances.size === 0) {
        return;
    }
    try {
        const instanceIds = [...loadedExternalInstances];
        const issued = issueExternalPluginTailRead(instanceIds);
        const readings = await readPluginTails(instanceIds);
        for (const { instance_id: instanceId, tail_samples: tailSamples } of readings) {
            const issue = issued.get(instanceId);
            if (issue) {
                publishExternalPluginTailRead(instanceId, issue, tailSamples);
            }
        }
    } catch (error) {
        logger.warn(`Failed to re-read external plugin tails: ${String(error)}`);
    }
}
