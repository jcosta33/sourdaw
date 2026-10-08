import { type Take, type TempoTimeline } from '../models/TakeLane';
import { type Clip } from '../stores/trackStore';

import { clipMediaOffsetAt } from './clipMediaOffsetAt';
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
 * `offsetAt(beat)` is the media offset a fragment starting at `beat` carries.
 * An audio reader converts it at the tempo of the fragment's own first beat,
 * so it is written from the media seconds the pass sounds at that beat — its
 * depth at its own start, plus the song time since — never by adding timeline
 * beats to a depth read at another tempo. A MIDI pass is placed in beats.
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
    clip: Clip,
    timeline: TempoTimeline
): { earliestBeat: number; sourceStartBeat: number; offsetAt: (beat: number) => number } {
    const clipOriginBeat = clipMediaOriginBeat(clip);
    if (take.sourceOffsetBeats === undefined) {
        return {
            earliestBeat: clip.startBeat,
            sourceStartBeat: clip.startBeat,
            offsetAt: (beat) => clipMediaOffsetAt(clip, beat, timeline),
        };
    }
    const sourceOffsetBeats = take.sourceOffsetBeats;
    const passShiftBeats = sourceOffsetBeats - (take.passStartBeats ?? 0);
    const passStartBeat = take.passStartBeats === undefined ? clip.startBeat : clipOriginBeat + take.passStartBeats;
    const earliestBeat = Math.max(clip.startBeat, passStartBeat);
    const sourceStartBeat = clip.startBeat - passShiftBeats;
    if (clip.type !== 'audio') {
        return { earliestBeat, sourceStartBeat, offsetAt: (beat) => beat - (clipOriginBeat - passShiftBeats) };
    }
    // The seconds into the media the pass sounds at its start, both read in
    // reader units at that beat: a placed pass holds its depth there; a pass
    // saved before placement existed starts at its clip's start, its depth
    // added to the clip's own offset.
    const passStartOffsetBeats =
        take.passStartBeats === undefined ? (clip.audioOffsetBeats ?? 0) + sourceOffsetBeats : sourceOffsetBeats;
    const passStartSeconds = (passStartOffsetBeats * 60) / timeline.tempoAtBeat(passStartBeat);
    return {
        earliestBeat,
        sourceStartBeat,
        offsetAt: (beat) => {
            const mediaSeconds =
                passStartSeconds + timeline.secondsAtBeat(beat) - timeline.secondsAtBeat(passStartBeat);
            return (mediaSeconds * timeline.tempoAtBeat(beat)) / 60;
        },
    };
}
