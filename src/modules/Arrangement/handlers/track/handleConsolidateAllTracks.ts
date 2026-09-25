import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { createHandler } from '#/utils/createHandler';
import { type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { type Track } from '../../models/Track';
import { collectTrackClipIds } from '../../services/collectTrackClipIds';
import { captureTrackClipStates } from '../../useCases/captureTrackClipStates';
import { removeTakesForClips } from '../../useCases/comping/removeTakesForClips';
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

/**
 * The clip ids each eligible track's bounce replaces, read before any bounce
 * lands. A replace-destination bounce swaps the track's whole clip collection
 * for the rendered clip, so every replaced id must retire its takes through the
 * shared rule — otherwise the orphan take keeps naming a clip no track holds
 * and its comp region silences the rendered replacement (#4518).
 */
function collectReplacedClipIdsByTrack(): ReadonlyMap<string, readonly string[]> {
    const replaced = new Map<string, readonly string[]>();
    for (const track of (getTrackStoreState()?.tracks ?? []).filter(isConsolidateEligibleTrack)) {
        replaced.set(track.id, collectTrackClipIds(track));
    }
    return replaced;
}

export const handleConsolidateAllTracks = createHandler<'consolidateAllTracks'>({
    execute: async (action) => {
        // Captured before the loop, while the command's storage transaction is
        // still ambient: only the first `bounceInPlace` runs before `execute`
        // crosses its first `await`, so a capture inside `bounceTrack` would
        // find no ambient transaction from the second track on and every later
        // bounce would commit on its own frame — outside the atomic commit the
        // command's undo entry and validators describe.
        const transactionScope = captureAutomergeStorageTransactionScope();

        const trackIds = resolveEligibleTrackIds();
        if (trackIds.length === 0) {
            return { status: 'no-write' };
        }
        const replacedClipIds = collectReplacedClipIdsByTrack();

        // Collected rather than discarded: `bounceInPlace` resolves `false` when
        // the bounce refused (an unrenderable device on the track, see
        // `buildDeviceChain`'s plugin refusal), and a loop where every track
        // refused wrote nothing — reporting `written` for it would file an
        // inert undo entry with no change behind it.
        let wroteAnyTrack = false;
        const writtenTrackIds: string[] = [];
        for (const trackId of trackIds) {
            // `recordUndoEntry: false` because this command owns one atomic undo unit for
            // the whole loop. Letting each bounce file its own callback entry would stack
            // them *below* this command's entry, each holding a whole-`tracks` snapshot
            // taken part-way through the loop — so undoing past this command would put the
            // earlier bounces back rather than continue unwinding.
            const wrote = await bounceInPlace(trackId, { recordUndoEntry: false, transactionScope });
            wroteAnyTrack ||= wrote;
            if (wrote) {
                writtenTrackIds.push(trackId);
            }
        }

        // Retire takes only for tracks whose bounce landed: a refused track kept
        // its clips, so its takes are still live and must not be removed.
        removeTakesForClips(writtenTrackIds.flatMap((trackId) => replacedClipIds.get(trackId) ?? []));

        // A pure read settling the undo payload: `bounceInPlace` (via
        // `bounceTrack`) owns every write this loop produces, and each of those
        // writes is already scoped to the command's transaction above.
        const pending = pendingConsolidateSnapshots.get(action);
        if (pending) {
            const settled = captureTrackClipStates(pending.trackIds);
            pending.postConsolidateState.push(...settled);
        }

        // A partial write is still a write: some tracks bounced and their
        // clips changed, so the undo unit has real content to restore.
        return { status: wroteAnyTrack ? 'written' : 'no-write' };
    },
    describe: (action) => {
        const trackIds = resolveEligibleTrackIds();
        if (trackIds.length === 0) {
            return { label: 'Consolidate all tracks', inverseAction: null };
        }

        const preConsolidateState = captureTrackClipStates(
            trackIds,
            [...collectReplacedClipIdsByTrack().values()].flat()
        );
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
