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

/** The instance id suffix of a segment the project groove moves out of its pass, placed back into it by the loop. */
export const LOOP_PASS_GROOVE_INSTANCE_SUFFIX = ':pass-groove';

const LOOP_PASS_SEGMENT_INSTANCE_SUFFIXES = [LOOP_PASS_OVERFLOW_INSTANCE_SUFFIX, LOOP_PASS_GROOVE_INSTANCE_SUFFIX];

function stripLoopPassSegmentSuffix(instanceId: string): string | undefined {
    for (const suffix of LOOP_PASS_SEGMENT_INSTANCE_SUFFIXES) {
        if (instanceId.endsWith(suffix)) {
            return instanceId.slice(0, -suffix.length);
        }
    }
    return undefined;
}

/** The note instance a segment was cut from: every tail and groove suffix removed. */
export function loopPassSourceInstanceId(instanceId: string): string {
    let sourceInstanceId = instanceId;
    let strippedInstanceId = stripLoopPassSegmentSuffix(sourceInstanceId);
    while (strippedInstanceId !== undefined) {
        sourceInstanceId = strippedInstanceId;
        strippedInstanceId = stripLoopPassSegmentSuffix(sourceInstanceId);
    }
    return sourceInstanceId;
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
 * Where a segment a pass hands on ends once the pass's sounding end cuts it: at its own end, or at
 * `soundingEndBeat` (the pass end, or the clip end when it comes first), the cut the synth projection makes
 * (`getGrooveProjection`) and a DAW makes at a region end. `undefined` when the cut leaves the segment no
 * length, as it leaves one starting at or after the sounding end.
 */
export function passSegmentSoundingEndBeat(
    startBeat: number,
    endBeat: number,
    soundingEndBeat: number
): number | undefined {
    const cutEndBeat = Math.min(endBeat, soundingEndBeat);
    return cutEndBeat > startBeat ? cutEndBeat : undefined;
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
 * Where a pass segment sounds once the project groove has moved its start to
 * `groovedStartBeat`, when that move carries it out of its pass: pushed to or
 * past the pass end, it lands on the head of the same pass; pulled back across
 * the head, it lands before the pass end, and what then rings past the pass
 * end is a tail struck on the head (`loopPassNoteOverflowBeats`). `undefined`
 * when the start stays inside the pass.
 *
 * A Yeast rack hands its output to the project groove, so a landing decided
 * after the rack can fall on a head the live windows have already played, and
 * a pulled-back segment's tail always does. Both routes therefore apply the
 * project groove to such a segment before the rack and hand on what it lands
 * as notes of their own, each owned by the window holding its start.
 */
export function loopPassGrooveDisplacedNoteStartBeat(
    groovedStartBeat: number,
    passStartBeat: number,
    loopLengthBeats: number
): number | undefined {
    const offsetBeats = groovedStartBeat - passStartBeat;
    if (offsetBeats >= 0 && loopLengthBeats - offsetBeats > LOOP_PASS_BEAT_TOLERANCE) {
        return undefined;
    }
    return loopPassNoteStartBeat(groovedStartBeat, passStartBeat, loopLengthBeats);
}
