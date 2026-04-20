import { describe, it, expect } from 'vitest';

import { getStretchRateBetweenMarkers } from '../getStretchRateBetweenMarkers';

const mk = (sourceSec: number, targetBeat: number) => ({
    id: 'm',
    sourceSec,
    targetBeat,
    locked: false,
});

describe('getStretchRateBetweenMarkers', () => {
    it('should return 1 when source or target duration is non-positive', () => {
        const a = mk(1, 0);
        const b = mk(1, 0);
        expect(getStretchRateBetweenMarkers(a, b, 120)).toBe(1);
    });

    it('should return source seconds divided by target seconds at the given bpm', () => {
        const a = mk(0, 0);
        const b = mk(2, 2);
        const bpm = 120;
        const targetSec = (2 / bpm) * 60;
        expect(getStretchRateBetweenMarkers(a, b, bpm)).toBeCloseTo(2 / targetSec);
    });
});
