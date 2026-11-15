import { logger } from '#/infra/logger/appLogger';

import { onPluginTailChanged } from '../../repositories/pluginBridge/onPluginTailChanged';
import { externalPluginTailStore, reviseExternalPluginTail } from '../../stores/externalPluginTailStore';

import { loadedExternalInstances } from './loadedExternalInstances';
import { tailRevisionsDuringLoad } from './tailRevisionsDuringLoad';

/**
 * The single live subscription, or `null` when none is running. Held as the
 * in-flight promise so concurrent activations cannot start a second listener
 * while the first is still resolving.
 */
let subscription: Promise<() => void> | null = null;

/**
 * Ensure the `plugin-tail-changed` subscription is live, revising the tail of
 * the instance each change names, or holding the change for the load to seed
 * when that instance's load has not returned yet.
 *
 * Idempotent: the first activation starts it and every later one reuses it. If
 * subscribing fails the slot is released so a later activation retries rather
 * than leaving tail changes permanently unheard.
 */
export function watchExternalPluginTail(): void {
    if (subscription) {
        return;
    }

    subscription = onPluginTailChanged(({ instance_id: instanceId, tail_samples: tailSamples }) => {
        if (!loadedExternalInstances.has(instanceId)) {
            return;
        }
        // Held but not yet seeded: the load is still in flight, and its own
        // answer, older than this one, must not overwrite it.
        if (externalPluginTailStore.value?.tailSamplesByInstanceId[instanceId] === undefined) {
            tailRevisionsDuringLoad.set(instanceId, tailSamples);
            return;
        }
        reviseExternalPluginTail(instanceId, tailSamples);
    }).catch((error: unknown) => {
        subscription = null;
        logger.warn(`Failed to subscribe to native plugin tail changes: ${String(error)}`);
        return () => {};
    });
}
