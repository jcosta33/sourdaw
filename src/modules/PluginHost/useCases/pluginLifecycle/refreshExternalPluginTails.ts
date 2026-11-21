import { logger } from '#/infra/logger/appLogger';

import { readPluginTails } from '../../repositories/pluginBridge/readPluginTails';
import {
    issueExternalPluginTailRead,
    publishExternalPluginTailRead,
    settleExternalPluginTailRead,
} from '../../stores/externalPluginTailStore';

import { loadedExternalInstances } from './loadedExternalInstances';
import { holdTailDuringLoad } from './tailRevisionsDuringLoad';

/**
 * How long the one retry waits for an instance the host could not reach. The
 * host refuses only while another control call holds the instance, which is
 * normally a block's length or a parameter write, and this is sized to outlast
 * that without making an export visibly wait.
 */
const BUSY_INSTANCE_RETRY_DELAY_MS = 40;

function pause(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

/** One read of the named instances, published by the rules below. Returns the ids the host answered. */
async function readAndPublish(instanceIds: readonly string[]): Promise<Set<string>> {
    const issued = issueExternalPluginTailRead(instanceIds);
    const answered = new Set<string>();
    try {
        const readings = await readPluginTails(instanceIds);
        for (const { instance_id: instanceId, tail_samples: tailSamples, sequence } of readings) {
            const issue = issued.get(instanceId);
            if (!issue) {
                continue;
            }
            answered.add(instanceId);
            const figure = { tailSamples, sequence };
            const outcome = publishExternalPluginTailRead(instanceId, issue, figure);
            // Loading: the answer is current but the seed has not landed, and the
            // seed would write the figure the plugin reported before this one.
            if (outcome === 'unseeded' && loadedExternalInstances.has(instanceId)) {
                holdTailDuringLoad(instanceId, figure);
            }
        }
    } finally {
        settleExternalPluginTailRead(issued);
    }
    return answered;
}

/**
 * Re-read every loaded external plugin instance's tail from the native host and
 * revise `externalPluginTailStore` with the answers.
 *
 * CLAP pushes a revised tail through `plugin-tail-changed`; VST3 has no such
 * notification, so a reverb switched to a longer preset after load would keep
 * its load-time figure. A caller that is about to size something from the tail
 * — an export — asks here first.
 *
 * Every answer carries the host's sequence, the order it takes this read and each
 * `plugin-tail-changed` event in, so an answer lands unless a figure the host
 * read later has landed, and never because of the order messages arrived in. An
 * answer is also dropped when a seed, an unload (and any reload under the same
 * id) or a graph rebuild touched the instance since the read was issued. An
 * answer for an instance still loading is held, and the load's seed applies it.
 *
 * An instance the host could not read because its control path was busy is read
 * once more after a short pause; one still unread keeps the figure it had.
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
        const answered = await readAndPublish(instanceIds);
        const unread = instanceIds.filter((instanceId) => !answered.has(instanceId));
        if (unread.length === 0) {
            return;
        }
        await pause(BUSY_INSTANCE_RETRY_DELAY_MS);
        const stillLoaded = unread.filter((instanceId) => loadedExternalInstances.has(instanceId));
        if (stillLoaded.length > 0) {
            await readAndPublish(stillLoaded);
        }
    } catch (error) {
        logger.warn(`Failed to re-read external plugin tails: ${String(error)}`);
    }
}
