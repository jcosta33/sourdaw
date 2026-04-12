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
    nextPosition: number
): FollowActionResult {
    let jumpToPosition: number | null = null;
    let shouldStop = false;

    // NOTE(§55.2): If multiple clips on different tracks trigger follow actions
    // in the same tick, the last track's clip wins (last-writer-wins). This is
    // intentional for now — changing the semantics requires understanding the
    // full implications of conflicting follow actions across tracks.
    for (const track of tracks) {
        for (const clip of track.clips as Clip[]) {
            if (clip.followAction && !clip.loopEnabled && prevPosition < clip.endBeat && nextPosition >= clip.endBeat) {
                if (clip.followAction === 'stop') {
                    shouldStop = true;
                } else if (clip.followAction === 'play_next') {
                    // Single-pass: find the clip with the smallest startBeat >= clip.endBeat
                    let nearest: Clip | null = null;
                    for (const c of track.clips as Clip[]) {
                        if (c.id !== clip.id && c.startBeat >= clip.endBeat) {
                            if (nearest === null || c.startBeat < nearest.startBeat) {
                                nearest = c;
                            }
                        }
                    }
                    if (nearest) {
                        jumpToPosition = nearest.startBeat;
                    }
                } else if (clip.followAction === 'play_previous') {
                    // Single-pass: find the clip with the largest startBeat where endBeat <= clip.startBeat
                    let nearest: Clip | null = null;
                    for (const c of track.clips as Clip[]) {
                        if (c.id !== clip.id && c.endBeat <= clip.startBeat) {
                            if (nearest === null || c.startBeat > nearest.startBeat) {
                                nearest = c;
                            }
                        }
                    }
                    if (nearest) {
                        jumpToPosition = nearest.startBeat;
                    }
                } else if (clip.followAction === 'play_first') {
                    // Single-pass: find the clip with the smallest startBeat
                    let first: Clip | null = null;
                    for (const c of track.clips as Clip[]) {
                        if (first === null || c.startBeat < first.startBeat) {
                            first = c;
                        }
                    }
                    if (first) {
                        jumpToPosition = first.startBeat;
                    }
                } else if (clip.followAction === 'play_last') {
                    // Single-pass: find the clip with the largest startBeat
                    let last: Clip | null = null;
                    for (const c of track.clips as Clip[]) {
                        if (last === null || c.startBeat > last.startBeat) {
                            last = c;
                        }
                    }
                    if (last) {
                        jumpToPosition = last.startBeat;
                    }
                } else if (clip.followAction === 'play_random') {
                    // Two-pass without allocation: count eligible clips, then pick the Nth
                    let count = 0;
                    for (const c of track.clips as Clip[]) {
                        if (c.id !== clip.id) {
                            count++;
                        }
                    }
                    if (count > 0) {
                        let target = Math.floor(Math.random() * count);
                        for (const c of track.clips as Clip[]) {
                            if (c.id !== clip.id) {
                                if (target === 0) {
                                    jumpToPosition = c.startBeat;
                                    break;
                                }
                                target--;
                            }
                        }
                    }
                }
            }
        }
    }

    return { jumpToPosition, shouldStop };
}
