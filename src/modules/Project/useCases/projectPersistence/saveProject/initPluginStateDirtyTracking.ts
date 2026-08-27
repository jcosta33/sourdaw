import { logger } from '#/infra/logger/appLogger';
import { watchPluginStateDirty } from '#/modules/PluginHost/useCases';

import { markDirty } from './markDirty';

/**
 * Mark the open project dirty whenever a hosted plugin reports that its own
 * state changed.
 *
 * An edit made inside a plugin's editor — a knob turned, a preset loaded — never
 * passes through this app, so no store changes and the arrangement subscription
 * sees nothing. The work is real and it is saved with the project, so without
 * this the project closes clean over edits the user made and watched happen.
 *
 * Shaped like `initProjectDirtyTracking`: the subscription is owned by a use
 * case rather than written inline in the composition root, so the wiring a
 * project load has to survive is the wiring a test can install.
 */
export function initPluginStateDirtyTracking(): () => void {
    const subscription = watchPluginStateDirty(() => {
        markDirty();
    }).catch((error: unknown) => {
        logger.warn(`Failed to subscribe to native plugin state changes: ${String(error)}`);
        return () => {};
    });

    return () => {
        void subscription.then((unlisten) => {
            unlisten();
        });
    };
}
