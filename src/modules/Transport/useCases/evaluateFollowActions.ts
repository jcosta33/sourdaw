import { type Clip, type Track } from '#/modules/Arrangement/models/Track';

/**
 * Deterministic pseudo-random number from a clip id + position seed.
 * Replaces Math.random() so that play_random follow actions replay
 * identically across sessions (§55.3).
 */
function seededRandom(clipId: string, position: number): number {
    let h = 2166136261;
    for (let index = 0; index < clipId.length; index++) {
        h ^= clipId.charCodeAt(index);
        h = Math.imul(h, 16777619);
    }
    h ^= Math.floor(position * 1e4) | 0;
    h = Math.imul(h, 16777619);
    // Fold to [0, 1).
    return ((h >>> 0) % 1_000_000) / 1_000_000;
}

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
        for (const clip of track.clips) {
            if (clip.followAction && !clip.loopEnabled && prevPosition < clip.endBeat && nextPosition >= clip.endBeat) {
                if (clip.followAction === 'stop') {
                    shouldStop = true;
                } else if (clip.followAction === 'play_next') {
                    // Single-pass: find the clip with the smallest startBeat >= clip.endBeat
                    let nearest: Clip | null = null;
                    for (const context of track.clips) {
                        if (context.id !== clip.id && context.startBeat >= clip.endBeat) {
                            if (nearest === null || context.startBeat < nearest.startBeat) {
                                nearest = context;
                            }
                        }
                    }
                    if (nearest) {
                        jumpToPosition = nearest.startBeat;
                    }
                } else if (clip.followAction === 'play_previous') {
                    // Single-pass: find the clip with the largest startBeat where endBeat <= clip.startBeat
                    let nearest: Clip | null = null;
                    for (const context of track.clips) {
                        if (context.id !== clip.id && context.endBeat <= clip.startBeat) {
                            if (nearest === null || context.startBeat > nearest.startBeat) {
                                nearest = context;
                            }
                        }
                    }
                    if (nearest) {
                        jumpToPosition = nearest.startBeat;
                    }
                } else if (clip.followAction === 'play_first') {
                    // Single-pass: find the clip with the smallest startBeat
                    let first: Clip | null = null;
                    for (const context of track.clips) {
                        if (first === null || context.startBeat < first.startBeat) {
                            first = context;
                        }
                    }
                    if (first) {
                        jumpToPosition = first.startBeat;
                    }
                } else if (clip.followAction === 'play_last') {
                    // Single-pass: find the clip with the largest startBeat
                    let last: Clip | null = null;
                    for (const context of track.clips) {
                        if (last === null || context.startBeat > last.startBeat) {
                            last = context;
                        }
                    }
                    if (last) {
                        jumpToPosition = last.startBeat;
                    }
                } else if (clip.followAction === 'play_random') {
                    // Two-pass without allocation: count eligible clips, then pick the Nth
                    let count = 0;
                    for (const context of track.clips) {
                        if (context.id !== clip.id) {
                            count++;
                        }
                    }
                    if (count > 0) {
                        let target = Math.floor(seededRandom(clip.id, prevPosition) * count);
                        for (const context of track.clips) {
                            if (context.id !== clip.id) {
                                if (target === 0) {
                                    jumpToPosition = context.startBeat;
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
