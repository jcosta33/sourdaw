import { describe, it, expect } from 'vitest';

import {
    A4_MIDI_NOTE,
    frequencyToMidiNote,
    midiNoteToFrequency,
    SEMITONES_PER_OCTAVE,
    STANDARD_A4_HZ,
} from '../pitch';

describe('12-TET anchors', () => {
    it('states concert A at MIDI note 69 and 12 semitones per octave', () => {
        expect(STANDARD_A4_HZ).toBe(440);
        expect(A4_MIDI_NOTE).toBe(69);
        expect(SEMITONES_PER_OCTAVE).toBe(12);
    });
});

describe('midiNoteToFrequency', () => {
    it('places A4 at 440 Hz', () => {
        expect(midiNoteToFrequency(69)).toBe(440);
    });

    it('doubles the frequency one octave up and halves it one octave down', () => {
        expect(midiNoteToFrequency(81)).toBe(880);
        expect(midiNoteToFrequency(57)).toBe(220);
    });

    it('places middle C (60) at 261.6256 Hz, the 12-TET grid value', () => {
        expect(midiNoteToFrequency(60)).toBeCloseTo(261.6255653, 6);
    });

    it('accepts fractional note numbers, the form MPE slide and bend produce', () => {
        // One quarter-tone above A4: 440 * 2^(0.5/12).
        expect(midiNoteToFrequency(69.5)).toBeCloseTo(452.8929841231365, 10);
    });
});

describe('frequencyToMidiNote', () => {
    it('inverts midiNoteToFrequency across the grid', () => {
        for (let note = 21; note <= 108; note += 1) {
            expect(frequencyToMidiNote(midiNoteToFrequency(note))).toBeCloseTo(note, 10);
        }
    });

    it('returns fractional note numbers, matching the callers it replaced', () => {
        // The old inline form: 69 + 12 * Math.log2(freq / 440).
        const frequency = 452.8929841231365;
        expect(frequencyToMidiNote(frequency)).toBeCloseTo(69.5, 10);
        expect(frequencyToMidiNote(frequency)).toBeCloseTo(69 + 12 * Math.log2(frequency / 440), 12);
    });
});
