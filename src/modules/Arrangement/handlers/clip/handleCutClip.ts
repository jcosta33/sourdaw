import { createHandler } from '#/utils/createHandler';
import { type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { clipSelectionStore } from '../../stores/clipSelectionStore';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { captureTrackClipStates } from '../../useCases/captureTrackClipStates';
import { cutSelectedClip } from '../../useCases/clipboard/cutSelectedClip';

type PendingCutSnapshot = {
    trackIds: readonly string[];
    // Mutated in place by `execute()` after the cut lands, once the emitted
    // `describe()` result already holds this same array by reference — the
    // describe-then-finalize pattern `handleFreezeTrack` uses for a post-state
    // only knowable after the write. `executeAppAction` builds the undo entry
    // from `describe()`'s return value AFTER `execute()` runs, which is why
    // mutating a referenced array here is visible in the committed entry.
    postCutState: TrackClipStateSnapshot[];
};

const pendingCutSnapshots = new WeakMap<object, PendingCutSnapshot>();

/** Mirrors the id-resolution `cutSelectedClip` performs internally, without its
 *  side effects — `describe()` runs before `execute()` and must know the
 *  target tracks before the cut has happened. */
function resolveSelectedTrackIds(): string[] {
    const workspace = clipSelectionStore.value;
    if (!workspace) {
        return [];
    }
    // A multi-selection wins; otherwise the single focused clip stands in for it, and an
    // empty selection yields no target at all.
    let ids: readonly string[] = [];
    if (workspace.selectedClipIds.length > 0) {
        ids = workspace.selectedClipIds;
    } else if (workspace.selectedClipId) {
        ids = [workspace.selectedClipId];
    }

    const trackIds = new Set<string>();
    for (const id of ids) {
        const target = resolveEligibleClipWriteTarget({ clipId: id });
        if (target.status === 'eligible' && 'trackId' in target) {
            trackIds.add(target.trackId);
        }
    }
    return [...trackIds];
}

export const handleCutClip = createHandler<'cutClip'>({
    execute: (action) => {
        if (!cutSelectedClip()) {
            return { status: 'no-write' };
        }

        const pending = pendingCutSnapshots.get(action);
        if (pending) {
            const settled = captureTrackClipStates(pending.trackIds);
            pending.postCutState.push(...settled);
        }

        return { status: 'written' };
    },
    describe: (action) => {
        const trackIds = resolveSelectedTrackIds();
        if (trackIds.length === 0) {
            return { label: 'Cut clip', inverseAction: null };
        }

        const preCutState = captureTrackClipStates(trackIds);
        // Empty placeholder now; `execute()` fills it once the cut lands, and
        // both `inverseAction.payload.expected` and `redoAction.payload.replacement`
        // reference this same array, so the fill is visible in both.
        const postCutState: TrackClipStateSnapshot[] = [];
        pendingCutSnapshots.set(action, { trackIds, postCutState });

        return {
            label: 'Cut clip',
            inverseAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: postCutState, replacement: preCutState },
            },
            redoAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: preCutState, replacement: postCutState },
            },
        };
    },
    undoable: true,
});
