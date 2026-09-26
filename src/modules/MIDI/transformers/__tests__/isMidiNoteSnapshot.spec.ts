import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { isMidiNoteSnapshot } from '../isMidiNoteSnapshot';

function note(overrides: Partial<MidiNote> = {}): MidiNote {
    return {
        id: 'a',
        pitch: 60,
        startBeat: 0,
        duration: 4,
        velocity: 100,
        ...overrides,
    };
}

describe('isMidiNoteSnapshot', () => {
    it('admits a note whose recorded expression curve is valid', () => {
        const validNote = note({ expression: { pressure: [{ offsetBeats: 1, value: 90 }] } });
        expect(isMidiNoteSnapshot([validNote])).toBe(true);
    });

    it('refuses a note whose expression curve point sits at or past duration', () => {
        const invalidNote = note({ expression: { pressure: [{ offsetBeats: 4, value: 90 }] } });
        expect(isMidiNoteSnapshot([invalidNote])).toBe(false);
    });

    it('refuses a note whose expression curve points are not strictly increasing', () => {
        const invalidNote = note({
            expression: {
                pressure: [
                    { offsetBeats: 2, value: 10 },
                    { offsetBeats: 1, value: 20 },
                ],
            },
        });
        expect(isMidiNoteSnapshot([invalidNote])).toBe(false);
    });
});
