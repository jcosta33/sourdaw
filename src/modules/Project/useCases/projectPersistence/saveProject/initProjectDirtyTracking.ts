import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { tempoProjectRevisionStore } from '#/modules/Transport/stores';

import { markDirty } from './markDirty';

/**
 * Mark the open project dirty for track and take-lane edits and committed tempo changes.
 *
 * Shaped like `initGrooveTemplateDirtyTracking`: the subscription is owned by a
 * use case rather than written inline in the composition root, so the wiring a
 * project load has to survive is the wiring a test can install.
 */
export function initProjectDirtyTracking(): () => void {
    const unsubscribeTracks = trackStore.subscribe(() => markDirty());
    const unsubscribeTakeLanes = takeLaneStore.subscribe(() => markDirty());
    const unsubscribeTempo = tempoProjectRevisionStore.subscribe(() => markDirty());
    return () => {
        unsubscribeTracks();
        unsubscribeTakeLanes();
        unsubscribeTempo();
    };
}
