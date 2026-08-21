import { createHandler } from '#/utils/createHandler';
import { type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { clipboardStore } from '../../stores/clipboardStore';
import { captureTrackClipStates } from '../../useCases/captureTrackClipStates';
import { pasteClip } from '../../useCases/clipboard/pasteClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

type PendingPasteSnapshot = {
    trackIds: readonly string[];
    // See `handleCutClip`'s matching field for the describe-then-finalize
    // rationale: `execute()` fills this in place once the paste lands, and
    // the `describe()` result already references this same array.
    postPasteState: TrackClipStateSnapshot[];
};

const pendingPasteSnapshots = new WeakMap<object, PendingPasteSnapshot>();

/** Mirrors the per-entry target-track resolution `pasteClip` performs
 *  internally, without its side effects — `describe()` runs before
 *  `execute()` and must know the target tracks before the paste has
 *  happened. */
function resolvePasteTargetTrackIds(): string[] {
    const clipClipboard = clipboardStore.value?.clipClipboard ?? [];
    if (clipClipboard.length === 0) {
        return [];
    }

    const trackState = getTrackStoreState();
    if (!trackState) {
        return [];
    }

    const trackIds = new Set<string>();
    for (const entry of clipClipboard) {
        trackIds.add(trackState.selectedTrackId ?? entry.sourceTrackId);
    }
    return [...trackIds];
}

export const handlePasteClip = createHandler<'pasteClip'>({
    execute: (action) => {
        if (!pasteClip()) {
            return { status: 'no-write' };
        }

        const pending = pendingPasteSnapshots.get(action);
        if (pending) {
            const settled = captureTrackClipStates(pending.trackIds);
            pending.postPasteState.push(...settled);
        }

        return { status: 'written' };
    },
    describe: (action) => {
        const trackIds = resolvePasteTargetTrackIds();
        if (trackIds.length === 0) {
            return { label: 'Paste clip', inverseAction: null };
        }

        const prePasteState = captureTrackClipStates(trackIds);
        const postPasteState: TrackClipStateSnapshot[] = [];
        pendingPasteSnapshots.set(action, { trackIds, postPasteState });

        return {
            label: 'Paste clip',
            inverseAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: postPasteState, replacement: prePasteState },
            },
            redoAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: prePasteState, replacement: postPasteState },
            },
        };
    },
    undoable: true,
});
