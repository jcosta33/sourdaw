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

    // #4876 — the snapshot is a dense note array: Array.prototype.every skips
    // missing slots, so a sparse hole used to read as "no invalid notes" and a
    // replay note array with a hole normalized away into an empty write.

    it('admits a dense array of valid notes', () => {
        expect(isMidiNoteSnapshot([note(), note({ id: 'b' })])).toBe(true);
    });

    it('admits a valid empty array', () => {
        expect(isMidiNoteSnapshot([])).toBe(true);
    });

    it('refuses a wholly sparse array', () => {
        const whollySparse: unknown[] = [];
        whollySparse.length = 1; // a missing slot — a hole, never a JSON value
        expect(isMidiNoteSnapshot(whollySparse)).toBe(false);
    });

    it('refuses a missing slot after a valid note', () => {
        const sparseAfterValidNote: MidiNote[] = [note()];
        sparseAfterValidNote.length = 2; // the slot after the valid note is missing
        expect(isMidiNoteSnapshot(sparseAfterValidNote)).toBe(false);
    });

    it('refuses an explicit JSON null element', () => {
        // A present position holding JSON null is invalid payload — distinct
        // from a missing slot, and equally not a note.
        expect(isMidiNoteSnapshot([null])).toBe(false);
    });
});
