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
 * `earliestBeat` is the first beat the take can sound. Every take is bounded by
 * its clip's start, so no take sounds outside its clip; a recording that began
 * inside the loop commits a clip opening at the loop start for exactly that
 * reason. A placed pass also never sounds before its own material, so the first
 * pass of such a recording waits for the record point. A pass recorded before
 * `passStartBeats` existed is bounded by its clip alone.
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
    const passStartBeat = take.passStartBeats === undefined ? clip.startBeat : clipOriginBeat + passStartBeats;
    return {
        originBeat: clipOriginBeat - passShiftBeats,
        earliestBeat: Math.max(clip.startBeat, passStartBeat),
        sourceStartBeat: clip.startBeat - passShiftBeats,
    };
}
