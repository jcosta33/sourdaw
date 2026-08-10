import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { midiNotesEqual } from '../midiNotesEqual';

function note(overrides: Partial<MidiNote> = {}): MidiNote {
    return {
        id: 'a',
        pitch: 60,
        startBeat: 0,
        duration: 1,
        velocity: 100,
        probability: 100,
        pressure: 0,
        slide: 0,
        pitchBend: 0,
        pitchBendRangeSemitones: 48,
        channel: 0,
        articulation: 'staccato',
        ...overrides,
    };
}

describe('midiNotesEqual', () => {
    it('returns true for identical arrays and false for different lengths', () => {
        const a = [note()];
        expect(midiNotesEqual(a, [note()])).toBe(true);
        expect(midiNotesEqual(a, [...a, note()])).toBe(false);
        expect(midiNotesEqual([], [])).toBe(true);
    });

    it('returns true when every comparable field matches', () => {
        const left = [note({ id: 'x', pitch: 55 }), note({ id: 'y', velocity: 80, channel: 3 })];
        const right = [note({ id: 'x', pitch: 55 }), note({ id: 'y', velocity: 80, channel: 3 })];
        expect(midiNotesEqual(left, right)).toBe(true);
    });

    it('returns false when any single field differs', () => {
        const base = note();
        const mutated: MidiNote[] = [
            { ...base, id: 'z' },
            { ...base, pitch: base.pitch + 1 },
            { ...base, startBeat: base.startBeat + 1 },
            { ...base, duration: base.duration + 1 },
            { ...base, velocity: base.velocity + 1 },
            { ...base, probability: (base.probability ?? 0) + 1 },
            { ...base, pressure: (base.pressure ?? 0) + 1 },
            { ...base, slide: (base.slide ?? 0) + 1 },
            { ...base, pitchBend: (base.pitchBend ?? 0) + 1 },
            { ...base, pitchBendRangeSemitones: (base.pitchBendRangeSemitones ?? 0) + 1 },
            { ...base, channel: (base.channel ?? 0) + 1 },
            { ...base, articulation: 'accent' },
        ];
        for (const right of mutated) {
            expect(midiNotesEqual([base], [right])).toBe(false);
        }
    });
});
