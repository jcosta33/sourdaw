import { logger } from '#/infra/logger/appLogger';
import { observeExternalPluginParameterEdits, watchPluginStateDirty } from '#/modules/PluginHost/useCases';

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
 * Two reports, because a plugin makes both and neither implies the other: a
 * plugin may declare its whole state dirty without naming a parameter, and it
 * may report a parameter it changed without ever declaring its state dirty. A
 * project that watched only the first would close clean over a knob ride in a
 * plugin that reports its edits precisely.
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

    // A gesture boundary changes nothing on its own — the user taking hold of a
    // control is not an edit, and marking dirty on one would have a project ask
    // to be saved over a knob that was touched and released.
    const stopObservingEdits = observeExternalPluginParameterEdits((edit) => {
        if (edit.kind !== 'value') {
            return;
        }
        markDirty();
    });

    return () => {
        stopObservingEdits();
        void subscription.then((unlisten) => {
            unlisten();
        });
    };
}
