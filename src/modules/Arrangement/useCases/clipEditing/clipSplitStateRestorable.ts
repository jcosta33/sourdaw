import { type ClipSplitActionSnapshot } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';
import { type Clip } from '../../stores/trackStore';

export type ClipSplitStateRestorableInput = {
    clipId: string;
    rightClipId: string;
    expected: ClipSplitActionSnapshot;
    replacement: ClipSplitActionSnapshot;
};

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

/** Same precondition `replaceClipSplitTrackState` writes against, kept as the sole export of its
 *  own file (rather than a second export alongside the write) so a handler's `validate` can
 *  preflight a batch without performing the write that `replaceClipSplitTrackState` performs once
 *  the precondition holds. Includes the replacement right-clip index bound check, since that is
 *  computed from current track state and is just as load-bearing as the snapshot match — a replay
 *  with a now-out-of-range index must be refused before executing, not during. */
export function clipSplitStateRestorable({
    clipId,
    rightClipId,
    expected,
    replacement,
}: ClipSplitStateRestorableInput): boolean {
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
    if (replacement.rightClip) {
        const clipsAfterRemoval = track.clips.filter((clip) => clip.id !== rightClipId).length;
        if (replacement.rightClipIndex < 0 || replacement.rightClipIndex > clipsAfterRemoval) {
            return false;
        }
    }
    return true;
}
