import { type ClipSnapshot, type ClipSplitActionSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { getTrackState } from '../../repositories/track/getTrackState';

export type ClipSplitStateRestorableInput = {
    clipId: string;
    rightClipId: string;
    expected: ClipSplitActionSnapshot;
    replacement: ClipSplitActionSnapshot;
};

function trackSnapshotMatches(
    clips: readonly ClipSnapshot[],
    clipId: string,
    rightClipId: string,
    expected: ClipSplitActionSnapshot
): boolean {
    const leftClip = clips.find((clip) => clip.id === clipId);
    const rightClipIndex = clips.findIndex((clip) => clip.id === rightClipId);
    const rightClip = rightClipIndex < 0 ? null : clips[rightClipIndex]!;
    const effectiveRightIndex = rightClipIndex < 0 ? clips.length : rightClipIndex;
    return (
        valuesEqual(leftClip ?? null, expected.leftClip) &&
        valuesEqual(rightClip, expected.rightClip) &&
        effectiveRightIndex === expected.rightClipIndex
    );
}

/** Same precondition `replaceClipSplitTrackState` writes against, kept as the sole export of its
 *  own file (rather than a second export alongside the write) so a handler's `validate` can
 *  preflight a batch without performing the write that `replaceClipSplitTrackState` performs once
 *  the precondition holds. Includes the replacement right-clip index bound check, since that is
 *  computed from current track state and is just as load-bearing as the snapshot match — a replay
 *  with a now-out-of-range index must be refused before executing, not during. */
export function clipSplitStateRestorable(
    { clipId, rightClipId, expected, replacement }: ClipSplitStateRestorableInput,
    state: { tracks: readonly { id: string; clips: readonly ClipSnapshot[] }[] } | null = getTrackState()
): boolean {
    if (
        expected.trackId !== replacement.trackId ||
        expected.leftClip.id !== clipId ||
        replacement.leftClip.id !== clipId ||
        (expected.rightClip !== null && expected.rightClip.id !== rightClipId) ||
        (replacement.rightClip !== null && replacement.rightClip.id !== rightClipId)
    ) {
        return false;
    }
    const track = state?.tracks.find((candidate) => candidate.id === expected.trackId);
    if (!state || !track || !trackSnapshotMatches(track.clips, clipId, rightClipId, expected)) {
        return false;
    }
    if (
        state.tracks.some(
            (candidate) =>
                candidate.id !== expected.trackId &&
                candidate.clips.some((clip) => clip.id === clipId || clip.id === rightClipId)
        ) ||
        state.tracks.flatMap((candidate) => candidate.clips).filter((clip) => clip.id === clipId).length !== 1 ||
        state.tracks.flatMap((candidate) => candidate.clips).filter((clip) => clip.id === rightClipId).length !==
            (expected.rightClip === null ? 0 : 1)
    ) {
        return false;
    }
    if (replacement.rightClip) {
        const clipsAfterRemoval = track.clips.filter((clip) => clip.id !== rightClipId).length;
        if (replacement.rightClipIndex < 0 || replacement.rightClipIndex > clipsAfterRemoval) {
            return false;
        }
    }
    return true;
}
