import { describe, it, expect } from 'vitest';

import { NOTE_NAMES, formatMidiNoteName } from '../noteNames';

describe('noteNames', () => {
    it('should expose twelve chromatic names in order', () => {
        expect(NOTE_NAMES).toEqual(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
    });

    describe('formatMidiNoteName', () => {
        it('names the first and last MIDI notes with their octave', () => {
            expect(formatMidiNoteName(0)).toBe('C-1');
            expect(formatMidiNoteName(127)).toBe('G9');
        });

        it('places middle C at octave 4', () => {
            expect(formatMidiNoteName(60)).toBe('C4');
        });

        it('uses sharps for black keys', () => {
            expect(formatMidiNoteName(61)).toBe('C#4');
            expect(formatMidiNoteName(62)).toBe('D4');
        });

        it.each([-1, 128, 1000, 60.5, Number.NaN, Number.POSITIVE_INFINITY])(
            'returns null for %s instead of throwing',
            (midiNote) => {
                expect(formatMidiNoteName(midiNote)).toBeNull();
            }
        );
    });
});
