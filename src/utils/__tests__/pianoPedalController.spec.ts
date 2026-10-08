import { describe, expect, it } from 'vitest';

import { isPianoPedalMoveEngaged, resolvePianoPedalMove } from '../pianoPedalController';

describe('resolvePianoPedalMove', () => {
    it('reads CC64 as a continuous sustain position', () => {
        expect(resolvePianoPedalMove(64, 127)).toEqual({ pedal: 'sustain', position: 1 });
        expect(resolvePianoPedalMove(64, 0)).toEqual({ pedal: 'sustain', position: 0 });
        expect(resolvePianoPedalMove(64, 63.5)).toEqual({ pedal: 'sustain', position: 0.5 });
    });

    it('clamps an out-of-range sustain value to the wire range', () => {
        expect(resolvePianoPedalMove(64, 300)).toEqual({ pedal: 'sustain', position: 1 });
        expect(resolvePianoPedalMove(64, -5)).toEqual({ pedal: 'sustain', position: 0 });
    });

    it('latches sostenuto and una corda at value 64', () => {
        expect(resolvePianoPedalMove(66, 64)).toEqual({ pedal: 'sostenuto', engaged: true });
        expect(resolvePianoPedalMove(66, 63)).toEqual({ pedal: 'sostenuto', engaged: false });
        expect(resolvePianoPedalMove(67, 127)).toEqual({ pedal: 'unaCorda', engaged: true });
        expect(resolvePianoPedalMove(67, 0)).toEqual({ pedal: 'unaCorda', engaged: false });
    });

    it('latches una corda at 64 exactly and not at 63, as sostenuto does', () => {
        const atThreshold = resolvePianoPedalMove(67, 64);
        const belowThreshold = resolvePianoPedalMove(67, 63);

        expect(atThreshold).toEqual({ pedal: 'unaCorda', engaged: true });
        expect(belowThreshold).toEqual({ pedal: 'unaCorda', engaged: false });
        expect(atThreshold && isPianoPedalMoveEngaged(atThreshold)).toBe(true);
        expect(belowThreshold && isPianoPedalMoveEngaged(belowThreshold)).toBe(false);
    });

    it('returns null for a controller that is not a pedal', () => {
        expect(resolvePianoPedalMove(1, 127)).toBeNull();
    });
});

describe('isPianoPedalMoveEngaged', () => {
    it('counts any non-zero sustain position as down and a latch by its state', () => {
        expect(isPianoPedalMoveEngaged({ pedal: 'sustain', position: 1 / 127 })).toBe(true);
        expect(isPianoPedalMoveEngaged({ pedal: 'sustain', position: 0 })).toBe(false);
        expect(isPianoPedalMoveEngaged({ pedal: 'sostenuto', engaged: true })).toBe(true);
        expect(isPianoPedalMoveEngaged({ pedal: 'unaCorda', engaged: false })).toBe(false);
    });
});
