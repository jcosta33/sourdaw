import { trackStore } from '#/modules/Arrangement/stores';
import { tempoProjectRevisionStore } from '#/modules/Transport/stores';

import { markDirty } from './markDirty';

/**
 * Mark the open project dirty for arrangement changes and committed tempo edits.
 *
 * Shaped like `initGrooveTemplateDirtyTracking`: the subscription is owned by a
 * use case rather than written inline in the composition root, so the wiring a
 * project load has to survive is the wiring a test can install.
 */
export function initProjectDirtyTracking(): () => void {
    const unsubscribeTracks = trackStore.subscribe(() => markDirty());
    const unsubscribeTempo = tempoProjectRevisionStore.subscribe(() => markDirty());
    return () => {
        unsubscribeTracks();
        unsubscribeTempo();
    };
}
