import { restoreMidiClipGlueState } from '#/modules/MIDI/useCases';
import { type ClipGlueActionSnapshot } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { applyClipAutomationLaneTransition } from '../clip/applyClipAutomationLaneTransition';
import { clipAutomationLaneTransitionMatchesStore } from '../clip/clipAutomationLaneTransitionMatchesStore';
import { insertReplacementClips } from '../clipReplacementSnapshot';
import { prepareClipSatelliteStateRestore } from '../timeOperations/prepareClipSatelliteStateRestore';

import { getClipIdCensus } from './getClipIdCensus';
import { hasClipGlueDependencies } from './hasClipGlueDependencies';

type RestoreClipGlueStateInput = {
    expected: ClipGlueActionSnapshot;
    replacement: ClipGlueActionSnapshot;
};

export function restoreClipGlueState({ expected, replacement }: RestoreClipGlueStateInput): boolean {
    if (expected.trackId !== replacement.trackId) {
        return false;
    }
    const affectedClipIds = expected.midi.clips.map((clip) => clip.clipId);
    const replacementAffectedClipIds = replacement.midi.clips.map((clip) => clip.clipId);
    const expectedClipIds = expected.clips.map((clip) => clip.id);
    const replacementClipIds = replacement.clips.map((clip) => clip.id);
    if (
        JSON.stringify(affectedClipIds) !== JSON.stringify(replacementAffectedClipIds) ||
        new Set(affectedClipIds).size !== affectedClipIds.length ||
        new Set(expectedClipIds).size !== expectedClipIds.length ||
        new Set(replacementClipIds).size !== replacementClipIds.length ||
        new Set(expected.clipOrder).size !== expected.clipOrder.length ||
        new Set(replacement.clipOrder).size !== replacement.clipOrder.length ||
        expectedClipIds.some((clipId) => !expected.clipOrder.includes(clipId)) ||
        replacementClipIds.some((clipId) => !replacement.clipOrder.includes(clipId)) ||
        expectedClipIds.some((clipId) => !affectedClipIds.includes(clipId)) ||
        replacementClipIds.some((clipId) => !affectedClipIds.includes(clipId))
    ) {
        return false;
    }
    if (hasClipGlueDependencies(affectedClipIds)) {
        return false;
    }
    const state = getTrackState();
    const track = state?.tracks.find((candidate) => candidate.id === expected.trackId);
    if (!state || !track) {
        return false;
    }
    const clipIdCensus = getClipIdCensus({ clipIds: affectedClipIds, state });
    const hasUnexpectedGlobalPlacement = affectedClipIds.some((clipId) => {
        const expectedClip = expected.clips.find((clip) => clip.id === clipId);
        const occurrences = clipIdCensus.get(clipId) ?? [];
        if (!expectedClip) {
            return occurrences.length > 0;
        }
        return (
            occurrences.length !== 1 ||
            occurrences[0]!.location !== 'active' ||
            occurrences[0]!.trackId !== expected.trackId
        );
    });
    if (hasUnexpectedGlobalPlacement) {
        return false;
    }
    const expectedIndexes = expected.clips.map((clip) =>
        track.clips.findIndex(
            (candidate) => candidate.id === clip.id && JSON.stringify(candidate) === JSON.stringify(clip)
        )
    );
    const expectedIdSet = new Set(expectedClipIds);
    const hasUnexpectedAffectedClip = track.clips.some(
        (clip) => affectedClipIds.includes(clip.id) && !expectedIdSet.has(clip.id)
    );
    if (expectedIndexes.some((index) => index < 0) || hasUnexpectedAffectedClip) {
        return false;
    }

    // Validate every store this operation touches BEFORE mutating any of
    // them — `restoreMidiClipGlueState` and `setTrackState` below have no
    // rollback, so a guard that fails after one of them has already written
    // would leave the transaction half-applied.
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
    // unchanged either way.
    if (
        !applyClipAutomationLaneTransition(
            affectedClipIds,
            expected.clipAutomationLanes,
            replacement.clipAutomationLanes
        )
    ) {
        return false;
    }

    const clips = insertReplacementClips({ affectedClipIds, currentClips: track.clips, replacement });
    setTrackState({
        ...state,
        tracks: state.tracks.map((candidate) => (candidate.id === track.id ? { ...candidate, clips } : candidate)),
    });
    return true;
}
