import { describe, expect, it } from 'vitest';

import { selectMidiNotesForLoopWindow } from '../selectMidiNotesForLoopWindow';

type ScheduledMidiNote = Parameters<typeof selectMidiNotesForLoopWindow>[0]['notes'][number];

function midiNote(id: string, startBeat: number, duration: number = 0.25): ScheduledMidiNote {
    return { id, pitch: 60, startBeat, duration, velocity: 100 };
}

function select(
    notes: readonly ScheduledMidiNote[],
    overrides: Partial<Parameters<typeof selectMidiNotesForLoopWindow>[0]> = {}
) {
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

describe('selectMidiNotesForLoopWindow', () => {
    it('returns only the current loop phase while preserving persisted note order', () => {
        const notes = [midiNote('late-in-window', 1.75), midiNote('outside', 3), midiNote('early-in-window', 1.25)];

        expect(select(notes).map((note) => note.id)).toEqual(['late-in-window', 'early-in-window']);
    });

    it('retains an interval whose wrapped segment starts at the iteration boundary', () => {
        const crossing = midiNote('crossing', 3.5, 1);

        expect(
            select([midiNote('outside', 2), crossing], {
                iterationStartBeat: 4,
                fromBeat: 4,
                toBeat: 4.25,
                lastScheduledBeat: 4,
            })
        ).toEqual([crossing]);
    });

    it('indexes negative source starts and MIDI offsets by their positive loop phase', () => {
        const wrapped = midiNote('wrapped', -0.25);

        expect(
            select([wrapped], {
                fromBeat: 3.7,
                toBeat: 3.9,
                lastScheduledBeat: 3.7,
            })
        ).toEqual([wrapped]);
    });

    it('excludes notes at or beyond the loop source boundary', () => {
        expect(select([midiNote('boundary', 4), midiNote('beyond', 5)])).toEqual([]);
    });

    it('does not turn one boundary-crossing interval into a full-loop scan', () => {
        const crossing = midiNote('crossing', 3.5, 1);
        const denseOutsideWindow = Array.from({ length: 1_000 }, (_, index) =>
            midiNote(`outside-${index}`, 2 + index / 10_000)
        );

        const selected = select([crossing, ...denseOutsideWindow], {
            iterationStartBeat: 4,
            fromBeat: 4,
            toBeat: 4.25,
            lastScheduledBeat: 4,
        });

        expect(selected).toEqual([crossing]);
    });

    it('rebuilds the phase index when a project write replaces the notes array', () => {
        const original = [midiNote('note', 3)];
        const replacement = [{ ...original[0]!, startBeat: 1.5 }];

        expect(select(original)).toEqual([]);
        expect(select(replacement)).toEqual(replacement);
    });
});
