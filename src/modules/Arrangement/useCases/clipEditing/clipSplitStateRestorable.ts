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
    const leftClipIndex = clips.findIndex((clip) => clip.id === clipId);
    const rightClipIndex = clips.findIndex((clip) => clip.id === rightClipId);
    const rightClip = rightClipIndex < 0 ? null : clips[rightClipIndex]!;
    return (
        valuesEqual(leftClip ?? null, expected.leftClip) &&
        valuesEqual(rightClip, expected.rightClip) &&
        Number.isSafeInteger(expected.rightClipIndex) &&
        expected.rightClipIndex >= 0 &&
        (expected.rightClip === null || rightClipIndex > leftClipIndex)
    );
}

function clipOwnershipMatches(
    tracks: readonly { id: string; clips: readonly ClipSnapshot[] }[],
    trackId: string,
    clipId: string,
    rightClipId: string,
    rightClipPresent: boolean
): boolean {
    if (
        tracks.some(
            (candidate) =>
                candidate.id !== trackId &&
                candidate.clips.some((clip) => clip.id === clipId || clip.id === rightClipId)
        )
    ) {
        return false;
    }
    const clips = tracks.flatMap((candidate) => candidate.clips);
    return (
        clips.filter((clip) => clip.id === clipId).length === 1 &&
        clips.filter((clip) => clip.id === rightClipId).length === (rightClipPresent ? 1 : 0)
    );
}

/** Same precondition `replaceClipSplitTrackState` writes against, kept as the sole export of its
 *  own file (rather than a second export alongside the write) so a handler's `validate` can
 *  preflight a batch without performing the write that `replaceClipSplitTrackState` performs once
 *  the precondition holds. The remembered right-clip index remains paired across
 *  the snapshots; a deleted unrelated predecessor may shorten the live track,
 *  so insertion uses the live end while keeping the right fragment after its left. */
export function clipSplitStateRestorable(
    { clipId, rightClipId, expected, replacement }: ClipSplitStateRestorableInput,
    state: { tracks: readonly { id: string; clips: readonly ClipSnapshot[] }[] } | null = getTrackState()
): boolean {
    if (
        expected.trackId !== replacement.trackId ||
        expected.leftClip.id !== clipId ||
        replacement.leftClip.id !== clipId ||
        expected.rightClipIndex !== replacement.rightClipIndex ||
        (expected.rightClip !== null && expected.rightClip.id !== rightClipId) ||
        (replacement.rightClip !== null && replacement.rightClip.id !== rightClipId)
    ) {
        return false;
    }
    const track = state?.tracks.find((candidate) => candidate.id === expected.trackId);
    if (!state || !track || !trackSnapshotMatches(track.clips, clipId, rightClipId, expected)) {
        return false;
    }
    if (!clipOwnershipMatches(state.tracks, expected.trackId, clipId, rightClipId, expected.rightClip !== null)) {
        return false;
    }
    if (replacement.rightClip) {
        const clipsAfterRemoval = track.clips.filter((clip) => clip.id !== rightClipId).length;
        const leftClipIndex = track.clips.findIndex((clip) => clip.id === clipId);
        if (
            !Number.isSafeInteger(replacement.rightClipIndex) ||
            replacement.rightClipIndex < 0 ||
            Math.min(replacement.rightClipIndex, clipsAfterRemoval) <= leftClipIndex
        ) {
            return false;
        }
    }
    return true;
}
