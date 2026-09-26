import { describe, it, expect } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { sliceMidiNoteExtent } from '../sliceMidiNoteExtent';

function swellNote(): MidiNote {
    return {
        id: 'n1',
        pitch: 60,
        startBeat: 0,
        duration: 4,
        velocity: 100,
        pressure: 10,
        channel: 2,
        expression: {
            pressure: [
                { offsetBeats: 1, value: 90 },
                { offsetBeats: 3, value: 20 },
            ],
        },
    };
}

describe('sliceMidiNoteExtent', () => {
    it('keeps only the points before the new end when the span keeps its start', () => {
        const sliced = sliceMidiNoteExtent(swellNote(), { fromOffset: 0, duration: 2 });

        expect(sliced).toEqual({
            id: 'n1',
            pitch: 60,
            startBeat: 0,
            duration: 2,
            velocity: 100,
            pressure: 10,
            channel: 2,
            expression: { pressure: [{ offsetBeats: 1, value: 90 }] },
        });
    });

    it('starts a later span from the value in effect there and re-bases the remaining points', () => {
        const sliced = sliceMidiNoteExtent(swellNote(), { fromOffset: 2, duration: 2 });

        expect(sliced.startBeat).toBe(2);
        expect(sliced.pressure).toBe(90);
        expect(sliced.expression).toEqual({ pressure: [{ offsetBeats: 1, value: 20 }] });
    });

    it('folds a point at exactly the new start into the scalar', () => {
        const sliced = sliceMidiNoteExtent(swellNote(), { fromOffset: 1, duration: 3 });

        expect(sliced.pressure).toBe(90);
        expect(sliced.expression).toEqual({ pressure: [{ offsetBeats: 2, value: 20 }] });
    });

    it('drops a point at exactly the new end', () => {
        const sliced = sliceMidiNoteExtent(swellNote(), { fromOffset: 0, duration: 3 });

        expect(sliced.expression).toEqual({ pressure: [{ offsetBeats: 1, value: 90 }] });
    });

    it('omits the expression when no point survives', () => {
        const sliced = sliceMidiNoteExtent(swellNote(), { fromOffset: 0, duration: 1 });

        expect(sliced).not.toHaveProperty('expression');
        expect(sliced.pressure).toBe(10);
    });

    it('holds the note-on value from an earlier start and moves every point later', () => {
        const sliced = sliceMidiNoteExtent(swellNote(), { fromOffset: -1, duration: 5 });

        expect(sliced.startBeat).toBe(-1);
        expect(sliced.pressure).toBe(10);
        expect(sliced.expression).toEqual({
            pressure: [
                { offsetBeats: 2, value: 90 },
                { offsetBeats: 4, value: 20 },
            ],
        });
    });

    it('sets a scalar the note lacked when the new start falls after a point', () => {
        const note: MidiNote = {
            id: 'n2',
            pitch: 62,
            startBeat: 4,
            duration: 2,
            velocity: 90,
            expression: { pitchBend: [{ offsetBeats: 0.5, value: 4096 }] },
        };

        const sliced = sliceMidiNoteExtent(note, { fromOffset: 1, duration: 1 });

        expect(sliced.startBeat).toBe(5);
        expect(sliced.pitchBend).toBe(4096);
        expect(sliced).not.toHaveProperty('expression');
    });

    it('re-cuts each dimension on its own', () => {
        const note: MidiNote = {
            ...swellNote(),
            slide: 64,
            expression: {
                pressure: [{ offsetBeats: 3, value: 20 }],
                slide: [{ offsetBeats: 1, value: 100 }],
            },
        };

        const sliced = sliceMidiNoteExtent(note, { fromOffset: 2, duration: 2 });

        expect(sliced.pressure).toBe(10);
        expect(sliced.slide).toBe(100);
        expect(sliced.expression).toEqual({ pressure: [{ offsetBeats: 1, value: 20 }] });
    });

    it('leaves a note without expression unchanged apart from its span', () => {
        const note: MidiNote = { id: 'n3', pitch: 60, startBeat: 1, duration: 2, velocity: 80, pressure: 30 };

        expect(sliceMidiNoteExtent(note, { fromOffset: 0, duration: 1 })).toEqual({ ...note, duration: 1 });
    });
});
