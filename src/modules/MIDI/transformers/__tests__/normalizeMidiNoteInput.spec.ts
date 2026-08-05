import { describe, expect, it } from 'vitest';

import { normalizeMidiNoteInput } from '../normalizeMidiNoteInput';

describe('normalizeMidiNoteInput', () => {
    it('passes through valid values unchanged and defaults probability to 100', () => {
        const result = normalizeMidiNoteInput({
            id: 'n1',
            pitch: 60,
            startBeat: 2,
            duration: 1,
            velocity: 100,
        });
        expect(result).toEqual({
            id: 'n1',
            pitch: 60,
            startBeat: 2,
            duration: 1,
            velocity: 100,
            probability: 100,
        });
    });

    it('rounds and clamps pitch to [0, 127]', () => {
        expect(normalizeMidiNoteInput({ id: 'a', pitch: 60.4, startBeat: 0, duration: 1 }).pitch).toBe(60);
        expect(normalizeMidiNoteInput({ id: 'b', pitch: 60.6, startBeat: 0, duration: 1 }).pitch).toBe(61);
        expect(normalizeMidiNoteInput({ id: 'c', pitch: -5, startBeat: 0, duration: 1 }).pitch).toBe(0);
        expect(normalizeMidiNoteInput({ id: 'd', pitch: 200, startBeat: 0, duration: 1 }).pitch).toBe(127);
    });

    it('clamps startBeat to non-negative', () => {
        expect(normalizeMidiNoteInput({ id: 'a', pitch: 60, startBeat: -3, duration: 1 }).startBeat).toBe(0);
        expect(normalizeMidiNoteInput({ id: 'b', pitch: 60, startBeat: 5, duration: 1 }).startBeat).toBe(5);
    });

    it('clamps duration to a minimum of 0.0625 (1/16 note)', () => {
        expect(normalizeMidiNoteInput({ id: 'a', pitch: 60, startBeat: 0, duration: 0 }).duration).toBe(0.0625);
        expect(normalizeMidiNoteInput({ id: 'b', pitch: 60, startBeat: 0, duration: 0.01 }).duration).toBe(0.0625);
        expect(normalizeMidiNoteInput({ id: 'c', pitch: 60, startBeat: 0, duration: 2 }).duration).toBe(2);
    });

    it('defaults velocity to 100 when omitted, rounds and clamps to [1, 127]', () => {
        expect(normalizeMidiNoteInput({ id: 'a', pitch: 60, startBeat: 0, duration: 1 }).velocity).toBe(100);
        expect(
            normalizeMidiNoteInput({
                id: 'b',
                pitch: 60,
                startBeat: 0,
                duration: 1,
                velocity: 50.7,
            }).velocity
        ).toBe(51);
        expect(
            normalizeMidiNoteInput({
                id: 'c',
                pitch: 60,
                startBeat: 0,
                duration: 1,
                velocity: 0,
            }).velocity
        ).toBe(1);
        expect(
            normalizeMidiNoteInput({
                id: 'd',
                pitch: 60,
                startBeat: 0,
                duration: 1,
                velocity: 300,
            }).velocity
        ).toBe(127);
    });
});
