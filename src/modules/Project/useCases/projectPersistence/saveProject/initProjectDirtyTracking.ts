import { trackStore } from '#/modules/Arrangement/stores';

import { markDirty } from './markDirty';

/**
 * Mark the open project dirty whenever the arrangement changes.
 *
 * Shaped like `initGrooveTemplateDirtyTracking`: the subscription is owned by a
 * use case rather than written inline in the composition root, so the wiring a
 * project load has to survive is the wiring a test can install.
 */
export function initProjectDirtyTracking(): () => void {
    return trackStore.subscribe(() => markDirty());
}
