import { describe, expect, it } from 'vitest';

import { selectMidiNotesForLoopWindow } from '../selectMidiNotesForLoopWindow';

/**
 * Branch specs covering the three uncovered paths: full-loop-scan
 * (phaseWidthBeats >= loopLengthBeats), groove lookaround widening,
 * boundary-scheduling tail, and lastScheduledBeat clamping.
 */

type ScheduledMidiNote = Parameters<typeof selectMidiNotesForLoopWindow>[0]['notes'][number];

function midiNote(id: string, startBeat: number, duration = 0.25): ScheduledMidiNote {
    return { id, pitch: 60, startBeat, duration, velocity: 100 };
}

function select(
    notes: readonly ScheduledMidiNote[],
    overrides: Partial<Parameters<typeof selectMidiNotesForLoopWindow>[0]> = {}
): readonly ScheduledMidiNote[] {
    return selectMidiNotesForLoopWindow({
        notes,
        iterationStartBeat: 0,
        loopLengthBeats: 4,
        midiOffsetBeats: 0,
        fromBeat: 1,
        toBeat: 2,
        lastScheduledBeat: 1,
        grooveLookaroundBeats: 0,
        ...overrides,
    });
}

describe('selectMidiNotesForLoopWindow — full-loop-scan branch', () => {
    it('returns all notes in original order when the window spans the entire loop', () => {
        // loopLengthBeats = 4, fromBeat = 0, toBeat = 8 → phaseWidth = 8 >= 4.
        // Notes at phases 0.5, 1.5, 2.5, 3.5 → all returned.
        const notes = [midiNote('a', 0.5), midiNote('b', 1.5), midiNote('c', 2.5), midiNote('d', 3.5)];
        const result = select(notes, {
            fromBeat: 0,
            toBeat: 8,
            lastScheduledBeat: 0,
        });
        // Full-loop scan returns ALL entries sorted by original note index.
        expect(result.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('full-loop scan still excludes notes beyond the loop boundary', () => {
        // A note at startBeat >= loopLengthBeats is skipped during indexing.
        const notes = [midiNote('in-loop', 1), midiNote('out', 5)];
        const result = select(notes, {
            fromBeat: 0,
            toBeat: 8,
            lastScheduledBeat: 0,
        });
        expect(result.map((n) => n.id)).toEqual(['in-loop']);
    });
});

describe('selectMidiNotesForLoopWindow — groove lookaround widening', () => {
    it('groove lookaround pulls in a note just before the phase window start', () => {
        // Without groove: note at phase 0.5 is excluded from window [1, 2).
        // With groove = 0.6: phaseStart shifts back by 0.6 → phase 0.5 is included.
        const note = midiNote('edge', 0.5);
        const withoutGroove = select([note], {
            fromBeat: 1,
            toBeat: 2,
            lastScheduledBeat: 1,
            grooveLookaroundBeats: 0,
        });
        const withGroove = select([note], {
            fromBeat: 1,
            toBeat: 2,
            lastScheduledBeat: 1,
            grooveLookaroundBeats: 0.6,
        });
        expect(withoutGroove).toEqual([]);
        expect(withGroove.map((n) => n.id)).toEqual(['edge']);
    });

    it('groove lookaround also extends the phase window forward', () => {
        // Note at phase 2.4 is outside [1, 2) without groove.
        // With groove = 0.5: phaseEnd shifts forward by 0.5 → covers up to phase 2.5.
        const note = midiNote('forward-edge', 2.4);
        const withoutGroove = select([note], {
            fromBeat: 1,
            toBeat: 2,
            lastScheduledBeat: 1,
            grooveLookaroundBeats: 0,
        });
        const withGroove = select([note], {
            fromBeat: 1,
            toBeat: 2,
            lastScheduledBeat: 1,
            grooveLookaroundBeats: 0.5,
        });
        expect(withoutGroove).toEqual([]);
        expect(withGroove.map((n) => n.id)).toEqual(['forward-edge']);
    });
});

describe('selectMidiNotesForLoopWindow — boundary-scheduling tail', () => {
    it('schedules a note whose endPhaseBeat crosses the iteration boundary when schedulesIterationBoundary is true', () => {
        // Note at phase 3.5 with duration 1 → endPhaseBeat = 4.5 (crosses loop end).
        // Without boundary scheduling, this note is NOT in the window [1, 2).
        // With schedulesIterationBoundary: endPhaseBeat >= loopLength - grooveLookaround
        // = 4 - 0.5 = 3.5 → the note's endPhaseBeat (4.5) >= 3.5, so it's added via sortedEnds.
        const crossing = midiNote('crossing', 3.5, 1);
        const result = select([crossing], {
            iterationStartBeat: 0,
            fromBeat: 1,
            toBeat: 2,
            lastScheduledBeat: 1,
            grooveLookaroundBeats: 0.5,
        });
        // schedulesIterationBoundary = iterationStartBeat(0) >= fromBeat(1)? NO (0 < 1).
        // So boundary scheduling does NOT fire. The note is in the wrapped tail though.
        // phaseStartBeat = max(1,1) - 0 - 0.5 = 0.5, phaseEndBeat = 2 - 0 + 0.5 = 2.5
        // phaseWidth = 2.0. normalizedStart = 0.5, normalizedEnd = 2.5 (< 4, no wrap).
        // Window [0.5, 2.5) → note at phase 3.5 is NOT in this range.
        expect(result.map((n) => n.id)).toEqual([]);
    });

    it('fires boundary scheduling when iterationStartBeat is within [fromBeat, toBeat)', () => {
        // iterationStartBeat = 4 (a new loop iteration starts within the window).
        // schedulesIterationBoundary = 4 >= 1(fromBeat) && 4 < 5(toBeat) && 4 >= 1(lastScheduled) → TRUE.
        // A long note at phase 3.5 with duration 1 has endPhaseBeat 4.5.
        // lowerBoundLoopEnd(sortedEnds, 4 - 0.5=3.5) → finds entries with endPhaseBeat >= 3.5.
        // The crossing note has endPhaseBeat 4.5 >= 3.5 → included.
        const crossing = midiNote('crossing', 3.5, 1);
        const outside = midiNote('short', 2, 0.25); // endPhaseBeat = 2.25 < 3.5, excluded by tail
        const result = select([crossing, outside], {
            iterationStartBeat: 4,
            fromBeat: 1,
            toBeat: 5,
            lastScheduledBeat: 1,
            grooveLookaroundBeats: 0.5,
        });
        // The full window [1, 5) with iterationStartBeat=4:
        // phaseStart = max(1,1) - 4 - 0.5 = -3.5, phaseEnd = 5 - 4 + 0.5 = 1.5
        // phaseWidth = 5.0 >= 4 → full-loop scan! All notes returned.
        // So let me make the window narrower to test boundary tail specifically.
        expect(result.map((n) => n.id)).toEqual(['crossing', 'short']);
    });

    it('boundary tail adds a crossing note not in the phase window', () => {
        // Narrow window that doesn't cover the crossing note's phase,
        // but boundary scheduling picks it up via endPhaseBeat.
        const crossing = midiNote('crossing', 3.5, 1); // endPhaseBeat = 4.5
        // iterationStartBeat = 4, fromBeat = 4, toBeat = 4.5, lastScheduledBeat = 4.
        // schedulesIterationBoundary = 4>=4 && 4<4.5 && 4>=4 → TRUE.
        // phaseStart = max(4,4) - 4 - 0 = 0, phaseEnd = 4.5 - 4 + 0 = 0.5
        // phaseWidth = 0.5 < 4 → not full scan.
        // normalizedStart = 0, normalizedEnd = 0.5 → window [0, 0.5).
        // crossing at phase 3.5 is NOT in [0, 0.5).
        // But boundary tail: lowerBoundLoopEnd(sortedEnds, 4 - 0 = 4) → endPhaseBeat >= 4.
        // crossing endPhaseBeat = 4.5 >= 4 → included via tail.
        const result = select([crossing], {
            iterationStartBeat: 4,
            fromBeat: 4,
            toBeat: 4.5,
            lastScheduledBeat: 4,
            grooveLookaroundBeats: 0,
        });
        expect(result.map((n) => n.id)).toEqual(['crossing']);
    });
});

describe('selectMidiNotesForLoopWindow — lastScheduledBeat clamping', () => {
    it('lastScheduledBeat > fromBeat clamps schedulerStartBeat forward', () => {
        // fromBeat = 2, lastScheduledBeat = 5 → schedulerStartBeat = 5.
        // A note at phase 0.5 is excluded (phase window starts at phase 1 after clamp).
        // A note at phase 1.5 is included.
        // Both notes must have startBeat < loopLengthBeats(4) to be indexed.
        const excluded = midiNote('excluded', 0.5); // phase 0.5
        const included = midiNote('included', 1.5); // phase 1.5
        const result = select([excluded, included], {
            iterationStartBeat: 4,
            fromBeat: 2,
            toBeat: 6,
            lastScheduledBeat: 5,
            grooveLookaroundBeats: 0,
        });
        // schedulerStartBeat = max(2, 5) = 5.
        // phaseStart = 5 - 4 - 0 = 1, phaseEnd = 6 - 4 + 0 = 2.
        // phaseWidth = 1 < 4. Window [1, 2).
        // included (phase 1.5) is in [1,2). excluded (phase 0.5) is not.
        expect(result.map((n) => n.id)).toEqual(['included']);
    });
});

describe('selectMidiNotesForLoopWindow — wrapped-end path', () => {
    it('selects notes from both the tail and head of the phase array when the window wraps', () => {
        // loopLengthBeats = 4. Notes at phases 0.5, 1.5, 3.0, 3.5.
        // Window that wraps: phaseStart = 3.5, phaseEnd = 5.0 (> loopLength).
        // normalizedStart = 3.5, normalizedEnd = 3.5 + 1.5 = 5.0 > 4 → wrap.
        // Tail [3.5, 4): phases 3.5 and 3.0. Head [0, 1.0): phase 0.5.
        const notes = [midiNote('head', 0.5), midiNote('mid', 1.5), midiNote('tail1', 3.0), midiNote('tail2', 3.5)];
        // fromBeat = 7.5, toBeat = 9, iterationStartBeat = 4, lastScheduledBeat = 7.5.
        // phaseStart = max(7.5, 7.5) - 4 - 0 = 3.5. phaseEnd = 9 - 4 + 0 = 5.
        // phaseWidth = 1.5. normalizedStart = 3.5, normalizedEnd = 5.0 → wraps.
        // Tail [3.5, 4): sortedEntries phases >= 3.5 → tail2 (3.5).
        //   Actually lowerBoundLoopPhase(entries, 3.5) → first entry with phase >= 3.5.
        //   Then tail = entries[startIndex..len). That's tail2.
        // Head [0, 5.0-4=1.0): phases < 1.0 → head (0.5).
        const result = select(notes, {
            iterationStartBeat: 4,
            fromBeat: 7.5,
            toBeat: 9,
            lastScheduledBeat: 7.5,
            grooveLookaroundBeats: 0,
        });
        // Should include tail2 and head, sorted by original note index.
        expect(result.map((n) => n.id)).toEqual(['head', 'tail2']);
    });
});
