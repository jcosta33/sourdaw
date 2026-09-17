import { describe, it, expect } from 'vitest';

import {
    clampMidiData7,
    HIGH_RESOLUTION_MAX,
    MAX_MIDI_DATA_7BIT,
    MIN_AUDIBLE_VELOCITY,
    PITCH_BEND_CENTER,
    PITCH_BEND_MAX,
    PITCH_BEND_MIN,
} from '../midiData';

describe('MIDI data constants', () => {
    it('states the 7-bit data ceiling', () => {
        expect(MAX_MIDI_DATA_7BIT).toBe(127);
    });

    it('states the 14-bit pair full scale and the centred bend span', () => {
        // 2^14 − 1 = 16383; the centre is exactly half the span, so the signed
        // range is asymmetric by one step: 8192 down, 8191 up.
        expect(HIGH_RESOLUTION_MAX).toBe(16383);
        expect(PITCH_BEND_CENTER).toBe(8192);
        expect(PITCH_BEND_MAX).toBe(8191);
        expect(PITCH_BEND_MIN).toBe(-8192);
    });

    it('keeps velocity 1 as the quietest sounding strike', () => {
        expect(MIN_AUDIBLE_VELOCITY).toBe(1);
    });
});

describe('clampMidiData7', () => {
    it('passes through in-range values unchanged', () => {
        expect(clampMidiData7(0)).toBe(0);
        expect(clampMidiData7(1)).toBe(1);
        expect(clampMidiData7(64)).toBe(64);
        expect(clampMidiData7(127)).toBe(127);
    });

    it('clamps values the seven-bit wire cannot carry', () => {
        expect(clampMidiData7(128)).toBe(127);
        expect(clampMidiData7(1000)).toBe(127);
        expect(clampMidiData7(-1)).toBe(0);
    });
});
