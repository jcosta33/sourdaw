import { type StripSilenceActionSnapshot } from '#/utils/handlerContract';

import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';

import { applyClipAutomationLaneTransition } from './clip/applyClipAutomationLaneTransition';
import { clipAutomationLaneTransitionMatchesStore } from './clip/clipAutomationLaneTransitionMatchesStore';
import { getClipIdCensus } from './clipEditing/getClipIdCensus';
import { insertReplacementClips } from './clipReplacementSnapshot';
import { prepareClipSatelliteStateRestore } from './timeOperations/prepareClipSatelliteStateRestore';

type RestoreStripSilenceStateInput = {
    expected: StripSilenceActionSnapshot;
    replacement: StripSilenceActionSnapshot;
};

/**
 * Apply (or, called with the arguments swapped, undo) one strip-silence
 * transition: `expected` is the snapshot the stores must currently hold and
 * `replacement` is the snapshot they hold afterward. Rejects without writing
 * anything if the live stores have drifted from `expected` along any
 * dimension the transition touches — the clip rectangles, the gain
 * envelope/warp state satellites, or the clip-scoped automation lanes
 * (ledger #2108).
 */
export function restoreStripSilenceState({ expected, replacement }: RestoreStripSilenceStateInput): boolean {
    if (expected.trackId !== replacement.trackId) {
        return false;
    }
    const affectedClipIds = expected.clipSatellites.map((entry) => entry.clipId);
    const replacementAffectedClipIds = replacement.clipSatellites.map((entry) => entry.clipId);
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
    // them, mirroring restoreClipGlueState's atomicity discipline: the
    // satellite and automation-lane guards must both pass before
    // `setTrackState` writes, so a later guard failure can never leave a
    // half-applied transaction.
    const expectedClipAutomationLanes = expected.clipAutomationLanes as never;
    const replacementClipAutomationLanes = replacement.clipAutomationLanes as never;
    const clipSatellitePreparation = prepareClipSatelliteStateRestore({
        version: 1,
        expected: { version: 1, entries: expected.clipSatellites },
        replacement: { version: 1, entries: replacement.clipSatellites },
    });
    if (clipSatellitePreparation.status !== 'ready') {
        return false;
    }
    // The completeness check re-reads live lanes for the full affected set,
    // so a lane added to a segment out of band (after the strip, before
    // undo) is detected here and blocks rather than getting silently
    // orphaned once that segment's clip id stops existing.
    if (!clipAutomationLaneTransitionMatchesStore(affectedClipIds, expectedClipAutomationLanes)) {
        return false;
    }

    // Gain envelope / warp state: every segment's satellites migrate in (or
    // the target's migrate back, on undo). Nothing else could have changed
    // the stores between the checks above and here — this function runs
    // synchronously — so `apply` cannot fail now.
    if (clipSatellitePreparation.hasChanges && !clipSatellitePreparation.apply()) {
        return false;
    }

    // Clip-scoped automation lanes: only the first segment can inherit one;
    // the rest (and the target's own, on redo) were retired.
    if (
        !applyClipAutomationLaneTransition(affectedClipIds, expectedClipAutomationLanes, replacementClipAutomationLanes)
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
