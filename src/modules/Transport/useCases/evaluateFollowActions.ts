import { type Clip, type Track } from '#/modules/Arrangement/models/Track';

export type FollowActionResult = {
    jumpToPosition: number | null;
    shouldStop: boolean;
};

/**
 * Evaluate follow-action business rules for all tracks at a given playhead
 * transition.
 *
 * This is a pure computation: it receives the tracks snapshot plus the previous
 * and next playhead positions, and returns a result that the scheduler uses to
 * decide whether to stop or jump. No side effects, no store access.
 *
 * @param tracks        Current tracks snapshot.
 * @param prevPosition  Playhead position before the tick delta was applied.
 * @param nextPosition  Playhead position after the tick delta was applied.
 */
export function evaluateFollowActions(
    tracks: readonly Track[],
    prevPosition: number,
    nextPosition: number,
): FollowActionResult {
    let jumpToPosition: number | null = null;
    let shouldStop = false;

    for (const track of tracks) {
        for (const clip of track.clips as Clip[]) {
            if (
                clip.followAction &&
                !clip.loopEnabled &&
                prevPosition < clip.endBeat &&
                nextPosition >= clip.endBeat
            ) {
                if (clip.followAction === 'stop') {
                    shouldStop = true;
                } else if (clip.followAction === 'play_next') {
                    const nextClips = track.clips.filter((c) => c.startBeat >= clip.endBeat && c.id !== clip.id);
                    nextClips.sort((a, b) => a.startBeat - b.startBeat);
                    if (nextClips[0]) {
                        jumpToPosition = nextClips[0].startBeat;
                    }
                } else if (clip.followAction === 'play_previous') {
                    const prevClips = track.clips.filter((c) => c.endBeat <= clip.startBeat && c.id !== clip.id);
                    prevClips.sort((a, b) => a.startBeat - b.startBeat);
                    if (prevClips[prevClips.length - 1]) {
                        jumpToPosition = prevClips[prevClips.length - 1]!.startBeat;
                    }
                } else if (clip.followAction === 'play_first') {
                    const firstClip = [...track.clips].sort((a, b) => a.startBeat - b.startBeat)[0];
                    if (firstClip) {
                        jumpToPosition = firstClip.startBeat;
                    }
                } else if (clip.followAction === 'play_last') {
                    const lastClip = [...track.clips].sort((a, b) => b.startBeat - a.startBeat)[0];
                    if (lastClip) {
                        jumpToPosition = lastClip.startBeat;
                    }
                } else if (clip.followAction === 'play_random') {
                    const otherClips = track.clips.filter((c) => c.id !== clip.id);
                    if (otherClips.length > 0) {
                        const randomClip = otherClips[Math.floor(Math.random() * otherClips.length)];
                        if (randomClip) {
                            jumpToPosition = randomClip.startBeat;
                        }
                    }
                }
            }
        }
    }

    return { jumpToPosition, shouldStop };
}
