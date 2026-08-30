import { logger } from '#/infra/logger/appLogger';

import { onPluginParametersRescanned } from '../../repositories/pluginBridge/onPluginParametersRescanned';

import { refreshExternalPluginParameters } from './refreshExternalPluginParameters';

/**
 * The single live subscription, or `null` when none is running. Held as the
 * in-flight promise so concurrent activations cannot start a second listener
 * while the first is still resolving.
 */
let subscription: Promise<() => void> | null = null;

/**
 * Ensure the `plugin-parameters-rescanned` subscription is live, re-reading one
 * instance's parameter contract whenever the plugin says it moved.
 *
 * A plugin renames, rescales or re-declares its controls after a preset load,
 * and announces it by calling `clap_host_params.rescan()`. Without this the
 * automation menu keeps offering the names and ranges the plugin had at load
 * time, and a lane resolves its range against a contract that no longer exists.
 *
 * Idempotent: the first activation starts it and every later one reuses it. If
 * subscribing fails the slot is released so a later activation retries rather
 * than leaving contract changes permanently unheard.
 */
export function watchExternalPluginParameterRescan(): void {
    if (subscription) {
        return;
    }

    subscription = onPluginParametersRescanned((rescanned) => {
        // Never throws, and leaves the existing snapshot standing on a refusal —
        // stale metadata is a better answer for the menu than none.
        void refreshExternalPluginParameters(rescanned.instance_id);
    }).catch((error: unknown) => {
        subscription = null;
        logger.warn(`Failed to subscribe to native plugin parameter rescans: ${String(error)}`);
        return () => {};
    });
}
