import { restoreMidiClipGlueState } from '#/modules/MIDI/useCases';
import { type ClipGlueActionSnapshot, type ClipStateSnapshot } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { type Clip } from '../../stores/trackStore';

import { hasClipGlueDependencies } from './hasClipGlueDependencies';

type RestoreClipGlueStateInput = {
    expected: ClipGlueActionSnapshot;
    replacement: ClipGlueActionSnapshot;
};

function cloneClip(snapshot: ClipStateSnapshot): Clip {
    return {
        ...structuredClone(snapshot),
        overrides: snapshot.overrides ? { ...snapshot.overrides } : undefined,
        kneadState: snapshot.kneadState
            ? {
                  ...snapshot.kneadState,
                  blobs: snapshot.kneadState.blobs.map((blob) => ({
                      ...blob,
                      pitchCurveCents: [...blob.pitchCurveCents],
                  })),
              }
            : undefined,
    };
}

function insertReplacementClips({
    affectedClipIds,
    currentClips,
    replacement,
}: {
    affectedClipIds: readonly string[];
    currentClips: readonly Clip[];
    replacement: ClipGlueActionSnapshot;
}): Clip[] {
    const currentAffectedIndexes = currentClips.flatMap((clip, index) =>
        affectedClipIds.includes(clip.id) ? [index] : []
    );
    const insertionAnchor = currentAffectedIndexes[0] ?? currentClips.length;
    const clips = currentClips.filter((clip) => !affectedClipIds.includes(clip.id));
    const replacementById = new Map(replacement.clips.map((clip) => [clip.id, clip]));
    let insertedReplacement = false;
    for (const clipId of replacement.clipOrder) {
        const replacementClip = replacementById.get(clipId);
        if (!replacementClip) {
            continue;
        }
        const orderIndex = replacement.clipOrder.indexOf(clipId);
        const precedingId = replacement.clipOrder
            .slice(0, orderIndex)
            .toReversed()
            .find((candidateId) => clips.some((clip) => clip.id === candidateId));
        const followingId = replacement.clipOrder
            .slice(orderIndex + 1)
            .find((candidateId) => clips.some((clip) => clip.id === candidateId));
        let insertionIndex = Math.min(insertionAnchor, clips.length);
        if (!insertedReplacement) {
            insertedReplacement = true;
        } else if (precedingId) {
            insertionIndex = clips.findIndex((clip) => clip.id === precedingId) + 1;
        } else if (followingId) {
            insertionIndex = Math.min(
                insertionIndex,
                clips.findIndex((clip) => clip.id === followingId)
            );
        }
        clips.splice(insertionIndex, 0, cloneClip(replacementClip));
    }
    return clips;
}

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
    if (!restoreMidiClipGlueState({ expected: expected.midi, replacement: replacement.midi })) {
        return false;
    }
    const clips = insertReplacementClips({ affectedClipIds, currentClips: track.clips, replacement });
    setTrackState({
        ...state,
        tracks: state.tracks.map((candidate) => (candidate.id === track.id ? { ...candidate, clips } : candidate)),
    });
    return true;
}
