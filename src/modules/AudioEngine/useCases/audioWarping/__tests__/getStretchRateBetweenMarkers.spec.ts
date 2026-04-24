import { describe, it, expect } from 'vitest';

import { getStretchRateBetweenMarkers } from '../getStretchRateBetweenMarkers';

function mk(sourceSec: number, targetBeat: number) {
    return {
        id: 'm',
        sourceSec,
        targetBeat,
        locked: false,
    };
}

describe('getStretchRateBetweenMarkers', () => {
    it('should return 1 when source or target duration is non-positive', () => {
        const alpha = mk(1, 0);
        const b = mk(1, 0);
        expect(getStretchRateBetweenMarkers(alpha, b, 120)).toBe(1);
    });

    it('should return source seconds divided by target seconds at the given bpm', () => {
        const alpha = mk(0, 0);
        const b = mk(2, 2);
        const bpm = 120;
        const targetSec = (2 / bpm) * 60;
        expect(getStretchRateBetweenMarkers(alpha, b, bpm)).toBeCloseTo(2 / targetSec);
    });
});
