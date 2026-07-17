import { describe, it, expect } from 'vitest';

import {
    PER_NOTE_PARAM_DESCRIPTORS,
    createDefaultPerNoteValues,
    midiNoteToKey,
    keyToMidiNote,
    keyToNoteName,
} from '../GrandBoulePerNoteParams';

describe('midiNoteToKey', () => {
    it('converts MIDI 21 (A0) to key 1', () => {
        expect(midiNoteToKey(21)).toBe(1);
    });
    it('converts MIDI 108 (C8) to key 88', () => {
        expect(midiNoteToKey(108)).toBe(88);
    });
    it('converts MIDI 60 (C4) to key 40', () => {
        expect(midiNoteToKey(60)).toBe(40);
    });
});

describe('keyToMidiNote', () => {
    it('converts key 1 to MIDI 21', () => {
        expect(keyToMidiNote(1)).toBe(21);
    });
    it('converts key 88 to MIDI 108', () => {
        expect(keyToMidiNote(88)).toBe(108);
    });
    it('is inverse of midiNoteToKey', () => {
        for (let midi = 21; midi <= 108; midi++) {
            expect(keyToMidiNote(midiNoteToKey(midi))).toBe(midi);
        }
    });
});

describe('createDefaultPerNoteValues', () => {
    it('returns all params at 1.0 (neutral)', () => {
        const v = createDefaultPerNoteValues();
        expect(v.hammerHardness).toBe(1.0);
        expect(v.hammerMass).toBe(1.0);
        expect(v.stringStiffness).toBe(1.0);
        expect(v.bridgeCoupling).toBe(1.0);
        expect(v.damperFirmness).toBe(1.0);
        expect(v.sympatheticGain).toBe(1.0);
        expect(v.strikePosition).toBe(1.0);
        expect(v.toneBrightness).toBe(1.0);
    });
});

describe('PER_NOTE_PARAM_DESCRIPTORS', () => {
    it('has 8 parameter descriptors', () => {
        expect(PER_NOTE_PARAM_DESCRIPTORS).toHaveLength(8);
    });
    it('all descriptors have label, min, max, defaultValue', () => {
        for (const d of PER_NOTE_PARAM_DESCRIPTORS) {
            expect(d.label).toBeTruthy();
            expect(d.min).toBeLessThan(d.max);
            expect(d.defaultValue).toBeGreaterThanOrEqual(d.min);
            expect(d.defaultValue).toBeLessThanOrEqual(d.max);
        }
    });
    it('all default values are 1.0', () => {
        for (const d of PER_NOTE_PARAM_DESCRIPTORS) {
            expect(d.defaultValue).toBe(1.0);
        }
    });
});

describe('keyToNoteName', () => {
    it('returns note name for key 1 (A0)', () => {
        const name = keyToNoteName(1);
        expect(name).toMatch(/A0/i);
    });
    it('returns note name for key 40 (middle C)', () => {
        const name = keyToNoteName(40);
        expect(name).toMatch(/C4/i);
    });
    it('returns note name for key 88 (C8)', () => {
        const name = keyToNoteName(88);
        expect(name).toMatch(/C8/i);
    });
});
