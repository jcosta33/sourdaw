import { createHandler } from '#/utils/createHandler';
import { type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { type Track } from '../../models/Track';
import { getHeldClips } from '../../models/TrackAlternativeClips';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { captureTrackClipStates } from '../../useCases/captureTrackClipStates';
import { removeTakesForClips } from '../../useCases/comping/removeTakesForClips';
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

/**
 * The clips the flatten replaces: those the track holds now. The active
 * alternative's stored copy is stale between switches and can still name a
 * clip since moved to another track, whose takes must survive this flatten.
 */
function heldClipIds(track: Track): string[] {
    return [...new Set(getHeldClips(track).map((clip) => clip.id))];
}

export const handleFlattenTrack = createHandler<'flattenTrack'>({
    execute: (action) => {
        const trackId = action.payload.trackId;
        // Read the replaced clip ids before the forward rewrites the collection:
        // the flatten swaps every clip (and alternative) for the baked render,
        // and each replaced id retires its takes through the shared rule so no
        // orphan take keeps naming a clip no track holds (#4518).
        const preFlattenTrack = getTrackStoreState()?.tracks.find((candidate) => candidate.id === trackId);
        const retiringClipIds = preFlattenTrack ? heldClipIds(preFlattenTrack) : [];
        const didWrite = flattenTrack(trackId);
        if (didWrite) {
            removeTakesForClips(retiringClipIds);
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

        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === trackId);
        const retiringClipIds = track ? heldClipIds(track) : [];
        // Naming the replaced ids makes the capture carry the take lanes the
        // forward retires, so undo puts them back with the pre-flatten clips.
        const preFlattenState = captureTrackClipStates([trackId], retiringClipIds);
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
