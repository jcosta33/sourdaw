import { describe, expect, it } from 'vitest';

import { getStretchRateBetweenMarkers } from '../getStretchRateBetweenMarkers';

import type { WarpMarker } from '#/modules/AudioEngine/stores/audioWarp';

function marker(sourceSec: number, targetBeat: number): WarpMarker {
    return { id: 'm', sourceSec, targetBeat, locked: false };
}

describe('getStretchRateBetweenMarkers', () => {
    it('should return 1 when source or target duration is non-positive', () => {
        const a = marker(0, 0);
        const b = marker(0, 4);
        expect(getStretchRateBetweenMarkers(a, b, 120)).toBe(1);
    });

    it('should return 1 when source time goes backward between markers', () => {
        const a = marker(2, 0);
        const b = marker(0, 4);
        expect(getStretchRateBetweenMarkers(a, b, 120)).toBe(1);
    });

    it('should return 1 when target beat span is non-positive', () => {
        const a = marker(0, 4);
        const b = marker(1, 2);
        expect(getStretchRateBetweenMarkers(a, b, 120)).toBe(1);
    });

    it('should return 1 when source and musical duration match at the given bpm', () => {
        const a = marker(0, 0);
        const b = marker(2, 4);
        expect(getStretchRateBetweenMarkers(a, b, 120)).toBeCloseTo(1);
    });

    it('should return the ratio of source seconds to scored seconds', () => {
        const a = marker(0, 0);
        const b = marker(2, 2);
        expect(getStretchRateBetweenMarkers(a, b, 120)).toBeCloseTo(2);
    });
});
