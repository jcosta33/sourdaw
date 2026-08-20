import { restoreMidiClipGlueState } from '#/modules/MIDI/useCases';
import { type ClipGlueActionSnapshot } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { applyClipAutomationLaneTransition } from '../clip/applyClipAutomationLaneTransition';
import { clipAutomationLaneTransitionMatchesStore } from '../clip/clipAutomationLaneTransitionMatchesStore';
import { removeClipSatelliteData } from '../clip/removeClipSatelliteData';
import { insertReplacementClips } from '../clipReplacementSnapshot';
import { prepareClipSatelliteStateRestore } from '../timeOperations/prepareClipSatelliteStateRestore';

import { clipGlueStateRestorable } from './clipGlueStateRestorable';

type RestoreClipGlueStateInput = {
    expected: ClipGlueActionSnapshot;
    replacement: ClipGlueActionSnapshot;
};

export function restoreClipGlueState({ expected, replacement }: RestoreClipGlueStateInput): boolean {
    const state = getTrackState();
    if (!clipGlueStateRestorable({ expected, replacement }, state)) {
        return false;
    }
    const track = state?.tracks.find((candidate) => candidate.id === expected.trackId);
    if (!state || !track) {
        return false;
    }
    const affectedClipIds = expected.midi.clips.map((clip) => clip.clipId);

    // Validate every store this operation touches BEFORE mutating any of
    // them — `restoreMidiClipGlueState` and `setTrackState` below have no
    // rollback, so a guard that fails after one of them has already written
    // would leave the transaction half-applied.
    //
    // The pre-flight covers the GUARDS, not the writes. `restoreMidiClipGlue
    // State` and `applyClipAutomationLaneTransition` can still refuse after
    // an earlier call committed, so every rejection below the satellite
    // `apply()` reverts it first. The division of labour is what makes that
    // necessary: the caller answers a rejection by aborting the Automerge
    // transaction, which rewinds the MIDI, track, gain-envelope and
    // automation stores — but `warpStates` is a plain module-level `Map` that
    // is not in that transaction and nothing else can put it back. Without
    // the revert, warp markers stay attached to the id this call was
    // migrating them to while every other store rewinds around them.
    const clipSatellitePreparation = prepareClipSatelliteStateRestore({
        version: 1,
        expected: { version: 1, entries: expected.clipSatellites },
        replacement: { version: 1, entries: replacement.clipSatellites },
    });
    if (clipSatellitePreparation.status !== 'ready') {
        return false;
    }
    // The completeness check re-reads live lanes for the full affected set,
    // so a lane added to the glued clip out of band (after glue, before
    // undo) is detected here and blocks rather than getting silently
    // orphaned once the glued clip id stops existing. It also covers the
    // replacement side's id collisions, so the apply below can only fail on
    // a store that refused the write outright.
    if (
        !clipAutomationLaneTransitionMatchesStore(
            affectedClipIds,
            expected.clipAutomationLanes,
            replacement.clipAutomationLanes
        )
    ) {
        return false;
    }

    if (!restoreMidiClipGlueState({ expected: expected.midi, replacement: replacement.midi })) {
        return false;
    }

    // Gain envelope / warp state: the first source's satellites migrate onto
    // the glued clip (or back, on undo); the rest were retired. Nothing else
    // could have changed the stores between the check above and here — this
    // whole function runs synchronously — so `apply` cannot fail now.
    if (clipSatellitePreparation.hasChanges && !clipSatellitePreparation.apply()) {
        return false;
    }

    // Clip-scoped automation lanes: every source's lanes are re-keyed onto
    // the glued clip (or back onto their sources, on undo). Points stay in
    // the absolute timeline frame they were authored in, so playback is
    // unchanged either way. `applyClipAutomationLaneTransition` is atomic on
    // the automation store, so a `false` here means it wrote nothing — but
    // the satellite `apply()` above did, and only `revert()` undoes that.
    if (
        !applyClipAutomationLaneTransition(
            affectedClipIds,
            expected.clipAutomationLanes,
            replacement.clipAutomationLanes
        )
    ) {
        if (clipSatellitePreparation.hasChanges) {
            clipSatellitePreparation.revert();
        }
        return false;
    }

    const clips = insertReplacementClips({ affectedClipIds, currentClips: track.clips, replacement });
    setTrackState({
        ...state,
        tracks: state.tracks.map((candidate) => (candidate.id === track.id ? { ...candidate, clips } : candidate)),
    });

    // `expected.clips` names only the side this call actually retires: the
    // source clips on the apply direction, the glued clip on the undo
    // direction — never both, since `clipGlueStateRestorable` already proved
    // the other side of `affectedClipIds` is absent from the track. Sweeping
    // exactly this set (not `affectedClipIds`, which always names every
    // participant on both directions) is what keeps this call from erasing
    // satellite state the opposite direction just restored. Gain envelope,
    // warp state, and clip-scoped automation lanes were already migrated or
    // retired above, so this only ever finds clipboard, drag-preview, and
    // active-recording references still pointing at the retired ids.
    const consumedClipIds = expected.clips.map((clip) => clip.id);
    removeClipSatelliteData(consumedClipIds);
    return true;
}
