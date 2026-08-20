import { midiClipGlueStateMatches } from '#/modules/MIDI/useCases';
import { type ClipGlueActionSnapshot } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';

import { getClipIdCensus } from './getClipIdCensus';
import { hasClipGlueDependencies } from './hasClipGlueDependencies';

export type ClipGlueStateRestorableInput = {
    expected: ClipGlueActionSnapshot;
    replacement: ClipGlueActionSnapshot;
};

/** Same precondition `restoreClipGlueState` writes against, kept as the sole export of its own
 *  file (rather than a second export alongside the write) so a handler's `validate` can preflight
 *  a batch without performing the track/MIDI writes that `restoreClipGlueState` performs once the
 *  precondition holds. */
export function clipGlueStateRestorable({ expected, replacement }: ClipGlueStateRestorableInput): boolean {
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
    return midiClipGlueStateMatches({ expected: expected.midi, replacement: replacement.midi });
}
