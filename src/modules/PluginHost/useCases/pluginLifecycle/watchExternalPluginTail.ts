import { logger } from '#/infra/logger/appLogger';

import { onPluginTailChanged } from '../../repositories/pluginBridge/onPluginTailChanged';
import { reviseExternalPluginTail } from '../../stores/externalPluginTailStore';

/**
 * The single live subscription, or `null` when none is running. Held as the
 * in-flight promise so concurrent activations cannot start a second listener
 * while the first is still resolving.
 */
let subscription: Promise<() => void> | null = null;

/**
 * Ensure the `plugin-tail-changed` subscription is live, revising the tail of
 * the instance each change names.
 *
 * Idempotent: the first activation starts it and every later one reuses it. If
 * subscribing fails the slot is released so a later activation retries rather
 * than leaving tail changes permanently unheard.
 */
export function watchExternalPluginTail(): void {
    if (subscription) {
        return;
    }

    subscription = onPluginTailChanged((change) => {
        reviseExternalPluginTail(change.instance_id, change.tail_samples);
    }).catch((error: unknown) => {
        subscription = null;
        logger.warn(`Failed to subscribe to native plugin tail changes: ${String(error)}`);
        return () => {};
    });
}
