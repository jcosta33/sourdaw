/**
 * How one pass of a looping clip plays a note: the segmentation every MIDI
 * route shares, the synth projection (`getGrooveProjection`) and the notes a
 * Yeast rack is handed, live and offline alike.
 *
 * A pass plays its loop region once. A start before the pass head re-anchors
 * by the loop length (a start a rounding step short of the loop end is the
 * next head), the note keeps at most one loop of its length, and the part
 * that would ring past the pass end wraps to the pass head as a second
 * segment: the note's tail, struck again on the head of the same pass.
 *
 * A Yeast rack must be handed the two segments as two notes, never the whole
 * note for the projection to wrap after the rack: live playback hands the rack
 * one scheduler window at a time, and the window holding the pass head cannot
 * see a note-on that only comes later in the pass. Only a tail that is its own
 * note-on at the head sounds there, whatever windows the timeline is cut into.
 *
 * These are scalar functions so a real-time window can place notes without
 * allocating. Beats are absolute timeline beats; `passStartBeat` is the pass's
 * seam on the loop grid.
 */

/**
 * Beats closer than this are one instant: the same tolerance
 * `src/modules/MIDI/models/SameBeatTolerance.ts` gives the loop machinery
 * (`src/utils` never imports domain modules, so the value is restated here).
 */
const LOOP_PASS_BEAT_TOLERANCE = 1e-9;

/** The instance id suffix of a note's tail struck on the pass head. */
export const LOOP_PASS_OVERFLOW_INSTANCE_SUFFIX = ':pass-head';

/** The instance id suffix of an in-pass segment the project groove pushes past the pass end, struck on the pass head. */
export const LOOP_PASS_PUSH_INSTANCE_SUFFIX = ':pass-push';

const LOOP_PASS_SEGMENT_INSTANCE_SUFFIXES = [LOOP_PASS_OVERFLOW_INSTANCE_SUFFIX, LOOP_PASS_PUSH_INSTANCE_SUFFIX];

/** The note instance a segment was cut from: the tail's or the push's suffix removed. */
export function loopPassSourceInstanceId(instanceId: string): string {
    for (const suffix of LOOP_PASS_SEGMENT_INSTANCE_SUFFIXES) {
        if (instanceId.endsWith(suffix)) {
            return instanceId.slice(0, -suffix.length);
        }
    }
    return instanceId;
}

/**
 * Where in the pass a note starting at `startBeat` sounds: re-anchored into `[passStart, passStart + loop)`.
 * The modulo leaves float noise even on a start already inside the pass; see `loopPassProducedNoteStartBeat`.
 */
export function loopPassNoteStartBeat(startBeat: number, passStartBeat: number, loopLengthBeats: number): number {
    const offsetBeats = startBeat - passStartBeat;
    const phaseBeats = ((offsetBeats % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
    if (loopLengthBeats - phaseBeats <= LOOP_PASS_BEAT_TOLERANCE) {
        return passStartBeat;
    }
    return passStartBeat + phaseBeats;
}

/**
 * Where a producer that hands the pass's notes on (a Yeast rack's input)
 * places a note's start: a start already inside the pass stays exactly where
 * it is, because a live window owns the note-on by comparing it against its
 * own edges, and modulo noise would move it out of the window holding it.
 * Every other start re-anchors as `loopPassNoteStartBeat` places it.
 */
export function loopPassProducedNoteStartBeat(
    startBeat: number,
    passStartBeat: number,
    loopLengthBeats: number
): number {
    const offsetBeats = startBeat - passStartBeat;
    if (offsetBeats >= 0 && loopLengthBeats - offsetBeats > LOOP_PASS_BEAT_TOLERANCE) {
        return startBeat;
    }
    return loopPassNoteStartBeat(startBeat, passStartBeat, loopLengthBeats);
}

/** Where the in-pass segment of a note placed at `passNoteStartBeat` ends: at its own end or the pass end. */
export function loopPassNoteEndBeat(
    passNoteStartBeat: number,
    durationBeats: number,
    passStartBeat: number,
    loopLengthBeats: number
): number {
    return Math.min(passStartBeat + loopLengthBeats, passNoteStartBeat + Math.min(durationBeats, loopLengthBeats));
}

/**
 * How long the tail struck on the pass head lasts: the part of the note's
 * kept length past the pass end, or 0 when the note ends inside the pass (a
 * remainder within float noise of none is none).
 */
export function loopPassNoteOverflowBeats(
    passNoteStartBeat: number,
    durationBeats: number,
    passStartBeat: number,
    loopLengthBeats: number
): number {
    const keptBeats = Math.min(durationBeats, loopLengthBeats);
    const inPassBeats =
        loopPassNoteEndBeat(passNoteStartBeat, durationBeats, passStartBeat, loopLengthBeats) - passNoteStartBeat;
    const overflowBeats = keptBeats - inPassBeats;
    return overflowBeats <= LOOP_PASS_BEAT_TOLERANCE ? 0 : overflowBeats;
}

/**
 * Where an in-pass segment sounds once the project groove has moved its start
 * to `groovedStartBeat`, when that move carries it to or past the pass end:
 * the loop law puts what runs past the pass end on the head of the same pass,
 * re-anchored by the loop. `undefined` when the start stays before the pass
 * end (a start pulled back across the head wraps later in the pass, where a
 * live window still reaches it).
 *
 * A Yeast rack hands its output to the project groove, so a push decided
 * after the rack would land on a head the live windows have already played.
 * Both routes therefore apply the project groove to such a segment before the
 * rack and hand it on as its own note at the landing, which the window holding
 * the head owns.
 */
export function loopPassPushedNoteStartBeat(
    groovedStartBeat: number,
    passStartBeat: number,
    loopLengthBeats: number
): number | undefined {
    if (loopLengthBeats - (groovedStartBeat - passStartBeat) > LOOP_PASS_BEAT_TOLERANCE) {
        return undefined;
    }
    return loopPassNoteStartBeat(groovedStartBeat, passStartBeat, loopLengthBeats);
}
