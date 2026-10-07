import { type Take } from '../models/TakeLane';
import { type Clip } from '../stores/trackStore';

import { clipMediaOriginBeat } from './clipMediaOriginBeat';

/**
 * The media a take plays, as one law for every consumer.
 *
 * A take that names `sourceOffsetBeats` is a loop-recorded pass: the material
 * that deep into the recording sounds `passStartBeats` after the clip's media
 * origin. Both are measured against the clip's media, so the pass follows every
 * edit that moves that media — a move or nudge carries it, a slip shifts it with
 * the rest of the content, and a trim leaves it where it was. A take without an
 * offset plays the clip's media as the clip places it.
 *
 * `earliestBeat` is the first beat the take can sound. A pass never sounds
 * before its own material. A clip still starting on its media's first sample
 * hides none of it, so a pass recorded ahead of that sample — recording started
 * inside the loop — plays across the loop; once the clip starts inside its media
 * its start bounds every pass, as it bounds any other take. A pass recorded
 * before `passStartBeats` existed sounds from the media origin and is bounded by
 * its clip alone.
 * `sourceStartBeat` carries the loop-occurrence count for probability rolls.
 */
export function resolveTakeMedia(
    take: Pick<Take, 'sourceOffsetBeats' | 'passStartBeats'>,
    clip: Clip
): { originBeat: number; earliestBeat: number; sourceStartBeat: number } {
    const clipOriginBeat = clipMediaOriginBeat(clip);
    if (take.sourceOffsetBeats === undefined) {
        return { originBeat: clipOriginBeat, earliestBeat: clip.startBeat, sourceStartBeat: clip.startBeat };
    }
    const passStartBeats = take.passStartBeats ?? 0;
    const passShiftBeats = take.sourceOffsetBeats - passStartBeats;
    return {
        originBeat: clipOriginBeat - passShiftBeats,
        earliestBeat: passEarliestBeat(take.passStartBeats, clipOriginBeat, clip.startBeat),
        sourceStartBeat: clip.startBeat - passShiftBeats,
    };
}

function passEarliestBeat(passStartBeats: number | undefined, clipOriginBeat: number, clipStartBeat: number): number {
    if (passStartBeats === undefined) {
        return clipStartBeat;
    }
    const passStartBeat = clipOriginBeat + passStartBeats;
    if (clipStartBeat > clipOriginBeat) {
        return Math.max(passStartBeat, clipStartBeat);
    }
    return passStartBeat;
}
