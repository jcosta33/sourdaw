import { updateClipInStore } from '#/modules/Arrangement/stores';

import { type KneadClipState } from '../stores/kneadStore';

import { applyKneadClipState } from './applyKneadClipState';
import { projectClipKneadState } from './projectClipKneadState';

/**
 * The user-edit path: publish to the Knead store and author the result onto the
 * clip's persisted `kneadState` through `updateClipInStore`, the CRDT-synced
 * project write. Every Knead-editor control writes through here, which makes it
 * the only route by which a clip gains persisted Knead state — state a musician
 * chose. Derived writers (automatic analysis) belong on
 * `updateTransientClipKneadState`.
 *
 * The clip carries only the shape `ClipKneadState` declares; the store state is
 * projected down before the write (see `projectClipKneadState`).
 */
export function updateClipKneadState(clipId: string, updater: (state: KneadClipState) => KneadClipState): void {
    const nextKneadState = applyKneadClipState(clipId, updater);
    if (!nextKneadState) {
        return;
    }

    updateClipInStore(clipId, (c) => ({ ...c, kneadState: projectClipKneadState(nextKneadState) }));
}
