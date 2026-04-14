import { describe, it, expect } from 'vitest';
import { adjustTempoPoint } from '../adjustTempoPoint';

describe('adjustTempoPoint', () => {
    it('should update the matching beat and mark manual with full confidence', () => {
        const points = [
            { beat: 0, bpm: 120, manual: false, confidence: 0.5 },
            { beat: 4, bpm: 128, manual: false, confidence: 0.5 },
        ];

        const next = adjustTempoPoint(points, 4, 130);

        expect(next[0]).toEqual(points[0]);
        expect(next[1]).toEqual({ beat: 4, bpm: 130, manual: true, confidence: 1 });
    });
});
