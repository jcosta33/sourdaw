import { createHandler } from '#/utils/createHandler';
import { type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { captureTrackClipStates } from '../../useCases/captureTrackClipStates';
import { flattenTrack } from '../../useCases/freezeBounce/flattenTrack';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type PendingFlattenSnapshot = {
    trackId: string;
    // Mutated in place by `execute()` after the flatten lands, once the emitted
    // `describe()` result already holds this same array by reference — the
    // describe-then-finalize pattern `handleCutClip` / `handleFreezeTrack` use
    // for a post-state only knowable after the write. `executeAppAction` builds
    // the undo entry from `describe()`'s return value AFTER `execute()` runs,
    // which is why mutating a referenced array here is visible in the
    // committed entry.
    postFlattenState: TrackClipStateSnapshot[];
};

const pendingFlattenSnapshots = new WeakMap<object, PendingFlattenSnapshot>();

/**
 * Mirrors `flattenTrack`'s own deterministic refusal conditions — eligible
 * write target, frozen, with a buffer id to bake — without its post-render
 * silent-buffer check, which only the use case itself can evaluate against
 * the actual cached audio. Shared by `isNoop` (so `executeAppAction` skips
 * `describe`/`execute` entirely) and `describe` (so a track this predicate
 * already rejects never gets a spurious inverse action pointing at a
 * pre-flatten state nothing will replace).
 */
function isFlattenNoop(trackId: string): boolean {
    const target = resolveEligibleClipWriteTarget({ trackId });
    if (target.status !== 'eligible') {
        return true;
    }
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === target.trackId);
    return !track || track.freezeState.status !== 'frozen' || !track.freezeState.frozenBufferId;
}

export const handleFlattenTrack = createHandler<'flattenTrack'>({
    execute: (action) => {
        const didWrite = flattenTrack(action.payload.trackId);
        if (didWrite) {
            const pending = pendingFlattenSnapshots.get(action);
            if (pending) {
                const settled = captureTrackClipStates([pending.trackId]);
                pending.postFlattenState.push(...settled);
            }
        }
        return toHandlerExecutionResult(didWrite);
    },
    describe: (action) => {
        const trackId = action.payload.trackId;
        if (isFlattenNoop(trackId)) {
            return { label: 'Flatten track', inverseAction: null };
        }

        const preFlattenState = captureTrackClipStates([trackId]);
        // Empty placeholder now; `execute()` fills it once the flatten lands, and
        // both `inverseAction.payload.expected` and `redoAction.payload.replacement`
        // reference this same array, so the fill is visible in both.
        const postFlattenState: TrackClipStateSnapshot[] = [];
        pendingFlattenSnapshots.set(action, { trackId, postFlattenState });

        return {
            label: 'Flatten track',
            inverseAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: postFlattenState, replacement: preFlattenState },
            },
            // Redo re-applies the exact flattened collection this run produced,
            // rather than replaying `flattenTrack` — re-running it would render
            // again from whatever the track holds at redo time, which is not
            // necessarily the frozen source this run actually flattened.
            redoAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: preFlattenState, replacement: postFlattenState },
            },
        };
    },
    isNoop: (action) => isFlattenNoop(action.payload.trackId),
    undoable: true,
});
