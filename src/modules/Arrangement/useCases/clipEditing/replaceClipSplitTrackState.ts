import { type ClipSplitActionSnapshot, type ClipStateSnapshot } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { type Clip } from '../../stores/trackStore';

type ReplaceClipSplitTrackStateInput = {
    clipId: string;
    rightClipId: string;
    expected: ClipSplitActionSnapshot;
    replacement: ClipSplitActionSnapshot;
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

function trackSnapshotMatches(
    clips: readonly Clip[],
    clipId: string,
    rightClipId: string,
    expected: ClipSplitActionSnapshot
): boolean {
    const leftClip = clips.find((clip) => clip.id === clipId);
    const rightClipIndex = clips.findIndex((clip) => clip.id === rightClipId);
    const rightClip = rightClipIndex < 0 ? null : clips[rightClipIndex]!;
    const effectiveRightIndex = rightClipIndex < 0 ? clips.length : rightClipIndex;
    return (
        JSON.stringify(leftClip ?? null) === JSON.stringify(expected.leftClip) &&
        JSON.stringify(rightClip) === JSON.stringify(expected.rightClip) &&
        effectiveRightIndex === expected.rightClipIndex
    );
}

export function replaceClipSplitTrackState({
    clipId,
    rightClipId,
    expected,
    replacement,
}: ReplaceClipSplitTrackStateInput): boolean {
    if (
        expected.trackId !== replacement.trackId ||
        expected.leftClip.id !== clipId ||
        replacement.leftClip.id !== clipId ||
        (expected.rightClip !== null && expected.rightClip.id !== rightClipId) ||
        (replacement.rightClip !== null && replacement.rightClip.id !== rightClipId)
    ) {
        return false;
    }
    const state = getTrackState();
    const track = state?.tracks.find((candidate) => candidate.id === expected.trackId);
    if (!state || !track || !trackSnapshotMatches(track.clips, clipId, rightClipId, expected)) {
        return false;
    }

    const clips = track.clips
        .filter((clip) => clip.id !== rightClipId)
        .map((clip) => (clip.id === clipId ? cloneClip(replacement.leftClip) : clip));
    if (replacement.rightClip) {
        if (replacement.rightClipIndex < 0 || replacement.rightClipIndex > clips.length) {
            return false;
        }
        clips.splice(replacement.rightClipIndex, 0, cloneClip(replacement.rightClip));
    }
    setTrackState({
        ...state,
        tracks: state.tracks.map((candidate) => (candidate.id === track.id ? { ...candidate, clips } : candidate)),
    });
    return true;
}
