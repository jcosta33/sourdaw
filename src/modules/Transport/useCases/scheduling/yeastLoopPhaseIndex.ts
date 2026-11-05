import {
    CLIP_LOOP_WINDOW_BEAT_TOLERANCE,
    isBeatInEnabledClipLoopWindow,
    resolveClipLoopOriginAdvance,
} from '#/utils/clipLoopOrigin';

import { MAX_GROOVE_STAGE_DISPLACEMENT_BEATS } from '../../services/midiSchedulerWindowGeometry';

import { type ScheduledMidiNote } from './getScheduledMidiNoteIndex';

type YeastLoopPhaseIndexInput = {
    notes: readonly ScheduledMidiNote[];
    loopLengthBeats: number;
    midiOffsetBeats: number;
    /** The owning clip's start — not the iteration's; the anchor's trim advance reads against it. */
    clipStartBeat: number;
    loopOriginBeat: number | undefined;
    loopEnabled: boolean;
};
type YeastLoopPhaseEntry = {
    endPhaseBeat: number;
    note: ScheduledMidiNote;
    phaseBeat: number;
};
type YeastLoopPhaseIndex = {
    clipStartBeat: number;
    loopEnabled: boolean;
    loopLengthBeats: number;
    loopOriginBeat: number | undefined;
    midiOffsetBeats: number;
    sortedEnds: readonly YeastLoopPhaseEntry[];
    sortedEntries: readonly YeastLoopPhaseEntry[];
};
type AddYeastLoopPhaseCandidatesInput = YeastLoopPhaseIndexInput & {
    candidates: Set<ScheduledMidiNote>;
    iterationStartBeat: number;
    fromBeat: number;
    toBeat: number;
};

// MIDI writes replace note arrays rather than mutating them, so array identity
// invalidates this cache whenever project truth changes.
const yeastLoopPhaseIndexes = new WeakMap<readonly ScheduledMidiNote[], YeastLoopPhaseIndex>();

// A full groove stage lands an event exactly one stage from its entry, where
// the groove arithmetic and the window bounds round independently. Admitting
// more is safe: candidates are a set, and each window posts only what it owns.
const PHASE_QUERY_SLACK_BEATS = MAX_GROOVE_STAGE_DISPLACEMENT_BEATS + CLIP_LOOP_WINDOW_BEAT_TOLERANCE;

function positiveModulo(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

function lowerBoundPhase(entries: readonly YeastLoopPhaseEntry[], phaseBeat: number): number {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (entries[middle]!.phaseBeat < phaseBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

function lowerBoundEnd(entries: readonly YeastLoopPhaseEntry[], endPhaseBeat: number): number {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (entries[middle]!.endPhaseBeat < endPhaseBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

/**
 * Phase view of the events a looped pass places away from its note's raw
 * start, which the content-window query cannot reach. A pass plays each note
 * as `loopPassNoteSegments` cuts it, so the events are:
 *
 * - a start before the pass head, re-anchored by the loop (the wrap class):
 *   starts already before the head, plus starts within one groove stage's
 *   displacement after it, which the clip groove can pull across the head
 *   (`MAX_GROOVE_STAGE_DISPLACEMENT_BEATS` bounds that displacement). Indexed
 *   at the wrapped start and at its release, which a pass never places past
 *   the pass end.
 * - a note that runs past the pass end (the crossing class, which a groove
 *   stage can push across too): its in-pass part is released on the pass end,
 *   and its tail is its own note struck on the pass head, released at the
 *   overflow. A start within two groove stages of the pass end belongs here
 *   too: the clip groove and then the project groove can push its in-pass
 *   segment past the pass end, and the pass strikes it on its head, released
 *   within one stage of it. So does a start within two stages after the head:
 *   the two grooves can pull it back across the head, onto the last stage of
 *   the pass, and its tail is struck on the head. Indexed at phase 0, at the
 *   last stage of the pass for a pulled-back start, and at every release,
 *   including a tail's release the two grooves pull up to two stages early.
 *
 * Every entry is a fixed offset into a pass, so the release query stays
 * unnormalized. Coverage rule: every start or release a groove can leave lies
 * within one stage of an entry, and both queries carry one stage of slack plus
 * a same-beat tolerance (`PHASE_QUERY_SLACK_BEATS`), so an entry exactly one
 * stage away, where full groove displacements land, is never lost to rounding.
 */
function getYeastLoopPhaseIndex({
    notes,
    loopLengthBeats,
    midiOffsetBeats,
    clipStartBeat,
    loopOriginBeat,
    loopEnabled,
}: YeastLoopPhaseIndexInput): YeastLoopPhaseIndex {
    const cached = yeastLoopPhaseIndexes.get(notes);
    if (
        cached?.loopLengthBeats === loopLengthBeats &&
        cached.midiOffsetBeats === midiOffsetBeats &&
        cached.clipStartBeat === clipStartBeat &&
        cached.loopOriginBeat === loopOriginBeat &&
        cached.loopEnabled === loopEnabled
    ) {
        return cached;
    }

    const orderByNote = new Map<ScheduledMidiNote, number>();
    const sortedEntries: YeastLoopPhaseEntry[] = [];
    const sortedEnds: YeastLoopPhaseEntry[] = [];
    // Iterations open on the anchor's pass grid: a row sits its
    // offset-relative start plus the trim advance into its pass.
    const loopAdvanceBeats = resolveClipLoopOriginAdvance({ startBeat: clipStartBeat, loopOriginBeat, loopEnabled });
    for (let index = 0; index < notes.length; index++) {
        const note = notes[index]!;
        orderByNote.set(note, index);
        const relativeStartBeat = note.startBeat - midiOffsetBeats;
        const passRelativeStartBeat = relativeStartBeat + loopAdvanceBeats;
        const phaseBeat = positiveModulo(passRelativeStartBeat, loopLengthBeats);
        const keptBeats = Math.min(note.duration, loopLengthBeats);
        const wrapsBeforeHead = passRelativeStartBeat < MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
        // A start inside the pass that the clip groove and then the project
        // groove can each carry one stage earlier is pulled back across the
        // head: it lands within one stage of the pass end and crosses it with
        // nearly all of its length.
        const pulledAcrossHead =
            passRelativeStartBeat >= 0 && passRelativeStartBeat < 2 * MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
        // A start the clip groove and then the project groove can each carry
        // one stage later is pushed past the pass end onto its head.
        const crossesPassEnd =
            pulledAcrossHead ||
            phaseBeat + keptBeats > loopLengthBeats - MAX_GROOVE_STAGE_DISPLACEMENT_BEATS ||
            phaseBeat > loopLengthBeats - 2 * MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
        if (!wrapsBeforeHead && !crossesPassEnd) {
            continue;
        }
        // #5198 — the loop window is the index's membership too: a row past
        // the trimmed region end, or stored at or past an anchorless loop's
        // length, never sounds on any pass, so it must not enter the index the
        // looped windows read.
        if (
            !isBeatInEnabledClipLoopWindow({
                relativeBeat: relativeStartBeat,
                startBeat: clipStartBeat,
                loopOriginBeat,
                loopLengthBeats,
                loopEnabled,
            })
        ) {
            continue;
        }
        if (wrapsBeforeHead) {
            const entry = { endPhaseBeat: Math.min(phaseBeat + note.duration, loopLengthBeats), note, phaseBeat };
            sortedEntries.push(entry);
            sortedEnds.push(entry);
        }
        if (crossesPassEnd) {
            const headTailReleaseBeat = phaseBeat + keptBeats - loopLengthBeats;
            const headTail = { endPhaseBeat: Math.max(0, headTailReleaseBeat), note, phaseBeat: 0 };
            sortedEntries.push(headTail);
            sortedEnds.push(headTail, { endPhaseBeat: loopLengthBeats, note, phaseBeat });
            // The clip groove moves the tail's release by up to a stage either
            // way. The project groove then leaves a pushed tail in its pass
            // (grooved after the rack, released where the clip groove left
            // it), but places a tail it pulls back across the head before the
            // rack, onto the pass end, and the rest is struck on the head
            // again: released up to a stage earlier still. So the release
            // runs from two stages before the uncut one to a stage after it:
            // the entry at the uncut release reaches the upper two stages and
            // a second one a stage before it the lowest. A tail no longer than
            // a stage needs none: a release the pull leaves on the head is
            // within a stage of the uncut one, and a pull that leaves nothing
            // on the head ends the placed piece within a stage of the pass end.
            if (headTailReleaseBeat > MAX_GROOVE_STAGE_DISPLACEMENT_BEATS) {
                sortedEnds.push({
                    endPhaseBeat: headTailReleaseBeat - MAX_GROOVE_STAGE_DISPLACEMENT_BEATS,
                    note,
                    phaseBeat: 0,
                });
            }
            if (pulledAcrossHead) {
                // The project groove is placed before the rack only on a
                // segment it moves out of its pass: one starting within a
                // stage after the head, pulled back by at most a stage, so it
                // lands within one stage before the pass end, and one start
                // entry a stage before the pass end reaches every landing. (An
                // in-pass segment the clip groove re-anchored near the pass end
                // stays in its pass under the project groove's pull; the rack
                // is handed it at its re-anchored start, which the wrap class
                // indexes, and the groove moves it after the rack. Its tail
                // struck on the head can still be pulled back across the head,
                // which the entry below reaches.)
                sortedEntries.push({
                    endPhaseBeat: loopLengthBeats,
                    note,
                    phaseBeat: loopLengthBeats - MAX_GROOVE_STAGE_DISPLACEMENT_BEATS,
                });
                // The tail struck on the head is released where the kept
                // length runs out after the start the two grooves left:
                // `kept + start − pull`, a pull of up to two stages, so one
                // release entry a stage short of `kept + start` reaches it.
                sortedEnds.push({
                    endPhaseBeat: keptBeats + passRelativeStartBeat - MAX_GROOVE_STAGE_DISPLACEMENT_BEATS,
                    note,
                    phaseBeat: 0,
                });
            }
            // An in-pass segment the project groove pushes onto the head is
            // released at most one stage in, where the push left its pass end.
            sortedEnds.push({ endPhaseBeat: MAX_GROOVE_STAGE_DISPLACEMENT_BEATS, note, phaseBeat: 0 });
        }
    }
    sortedEntries.sort(
        (left, right) => left.phaseBeat - right.phaseBeat || orderByNote.get(left.note)! - orderByNote.get(right.note)!
    );
    const created = {
        clipStartBeat,
        loopEnabled,
        loopLengthBeats,
        loopOriginBeat,
        midiOffsetBeats,
        sortedEnds: sortedEnds.sort((left, right) => left.endPhaseBeat - right.endPhaseBeat),
        sortedEntries,
    };
    yeastLoopPhaseIndexes.set(notes, created);
    return created;
}

/**
 * Adds the notes a looped iteration places inside `[fromBeat, toBeat)` away
 * from their raw start: their wrapped start, their pass-head tail, or either
 * release. The window normalizes into loop phase for starts and may itself
 * straddle the seam; the release query reads offsets into the pass as they are.
 */
export function addYeastLoopPhaseCandidates({
    candidates,
    iterationStartBeat,
    fromBeat,
    toBeat,
    ...indexInput
}: AddYeastLoopPhaseCandidatesInput): void {
    const { loopLengthBeats } = indexInput;
    const loopIndex = getYeastLoopPhaseIndex(indexInput);
    const phaseStartBeat = fromBeat - iterationStartBeat - PHASE_QUERY_SLACK_BEATS;
    const phaseEndBeat = toBeat - iterationStartBeat + PHASE_QUERY_SLACK_BEATS;
    const phaseWidthBeats = phaseEndBeat - phaseStartBeat;
    if (phaseWidthBeats >= loopLengthBeats) {
        for (const { note } of loopIndex.sortedEntries) {
            candidates.add(note);
        }
    } else {
        const normalizedStartBeat = positiveModulo(phaseStartBeat, loopLengthBeats);
        const normalizedEndBeat = normalizedStartBeat + phaseWidthBeats;
        const phaseStartIndex = lowerBoundPhase(loopIndex.sortedEntries, normalizedStartBeat);
        if (normalizedEndBeat <= loopLengthBeats) {
            const phaseEndIndex = lowerBoundPhase(loopIndex.sortedEntries, normalizedEndBeat);
            for (let index = phaseStartIndex; index < phaseEndIndex; index++) {
                candidates.add(loopIndex.sortedEntries[index]!.note);
            }
        } else {
            const wrappedEndIndex = lowerBoundPhase(loopIndex.sortedEntries, normalizedEndBeat - loopLengthBeats);
            for (let index = phaseStartIndex; index < loopIndex.sortedEntries.length; index++) {
                candidates.add(loopIndex.sortedEntries[index]!.note);
            }
            for (let index = 0; index < wrappedEndIndex; index++) {
                candidates.add(loopIndex.sortedEntries[index]!.note);
            }
        }
    }
    const releaseStartIndex = lowerBoundEnd(loopIndex.sortedEnds, phaseStartBeat);
    const releaseEndIndex = lowerBoundEnd(loopIndex.sortedEnds, phaseEndBeat);
    for (let index = releaseStartIndex; index < releaseEndIndex; index++) {
        candidates.add(loopIndex.sortedEnds[index]!.note);
    }
}
