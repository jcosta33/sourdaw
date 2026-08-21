import { createHandler } from '#/utils/createHandler';
import { type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { type Track } from '../../models/Track';
import { captureTrackClipStates } from '../../useCases/captureTrackClipStates';
import { bounceInPlace } from '../../useCases/freezeBounce/bounceInPlace';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

type PendingConsolidateSnapshot = {
    trackIds: readonly string[];
    // Mutated in place by `execute()` once every eligible track's bounce has
    // landed, once the emitted `describe()` result already holds this same
    // array by reference — the same describe-then-finalize pattern
    // `handleFlattenTrack` / `handleCutClip` use, generalized to every track
    // the loop touches so the whole consolidation lands as one undo unit
    // instead of one per track.
    postConsolidateState: TrackClipStateSnapshot[];
};

const pendingConsolidateSnapshots = new WeakMap<object, PendingConsolidateSnapshot>();

/**
 * The track set consolidation touches. Named and shared by BOTH `describe`
 * and `execute` (via `resolveEligibleTrackIds`) on purpose: if the two ever
 * selected different tracks, the pre-state `describe` captures and the
 * tracks `execute` actually bounces would drift apart, silently dropping a
 * track from the undo unit.
 */
function isConsolidateEligibleTrack(track: Track): boolean {
    return (track.kind === 'audio' || track.kind === 'midi') && track.clips.length > 0;
}

function resolveEligibleTrackIds(): string[] {
    return (getTrackStoreState()?.tracks ?? []).filter(isConsolidateEligibleTrack).map((track) => track.id);
}

export const handleConsolidateAllTracks = createHandler<'consolidateAllTracks'>({
    execute: async (action) => {
        const trackIds = resolveEligibleTrackIds();
        if (trackIds.length === 0) {
            return { status: 'no-write' };
        }

        for (const trackId of trackIds) {
            // `recordUndoEntry: false` because this command owns one atomic undo unit for
            // the whole loop. Letting each bounce file its own callback entry would stack
            // them *below* this command's entry, each holding a whole-`tracks` snapshot
            // taken part-way through the loop — so undoing past this command would put the
            // earlier bounces back rather than continue unwinding.
            await bounceInPlace(trackId, { recordUndoEntry: false });
        }

        // A pure read: `bounceInPlace` (via `bounceTrack`) owns every write this
        // loop produces, so nothing here needs its own Automerge transaction
        // scope captured across the `await`s above.
        const pending = pendingConsolidateSnapshots.get(action);
        if (pending) {
            const settled = captureTrackClipStates(pending.trackIds);
            pending.postConsolidateState.push(...settled);
        }

        return { status: 'written' };
    },
    describe: (action) => {
        const trackIds = resolveEligibleTrackIds();
        if (trackIds.length === 0) {
            return { label: 'Consolidate all tracks', inverseAction: null };
        }

        const preConsolidateState = captureTrackClipStates(trackIds);
        // Empty placeholder now; `execute()` fills it once every eligible
        // track's bounce lands, and both `inverseAction.payload.expected` and
        // `redoAction.payload.replacement` reference this same array, so the
        // fill is visible in both.
        const postConsolidateState: TrackClipStateSnapshot[] = [];
        pendingConsolidateSnapshots.set(action, { trackIds, postConsolidateState });

        return {
            label: 'Consolidate all tracks',
            inverseAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: postConsolidateState, replacement: preConsolidateState },
            },
            // Redo re-applies the exact consolidated collections this run
            // produced, rather than replaying `consolidateAllTracks` — re-running
            // it would bounce again from whatever each track holds at redo time.
            redoAction: {
                type: 'restoreTrackClipStates',
                payload: { expected: preConsolidateState, replacement: postConsolidateState },
            },
        };
    },
    isNoop: () => resolveEligibleTrackIds().length === 0,
    undoable: true,
});
