import { describe, it, expect } from 'vitest';

import { simplifyGesturePoints } from '../simplifyGesturePoints';

describe('simplifyGesturePoints', () => {
    it('collapses a dense collinear stroke to its endpoints at the default tolerance, preserving them exactly', () => {
        const raw = Array.from({ length: 21 }, (_unused, index) => ({
            beat: index * 0.1,
            value: index * 0.05,
            curve: 'linear' as const,
            tension: 0,
        }));

        const thinned = simplifyGesturePoints(raw);

        expect(thinned.length).toBeLessThan(raw.length);
        expect(thinned).toEqual([raw[0], raw[raw.length - 1]]);
    });

    it('retains an interior point whose deviation exceeds the tolerance', () => {
        const raw = [
            { beat: 0, value: 0, curve: 'linear' as const, tension: 0 },
            { beat: 1, value: 0.9, curve: 'linear' as const, tension: 0 },
            { beat: 2, value: 0, curve: 'linear' as const, tension: 0 },
        ];

        expect(simplifyGesturePoints(raw)).toEqual(raw);
    });

    it('is generic over any beat/value carrier and preserves the extra fields of retained points', () => {
        // A carrier shaped like Arrangement's AutomationViewTypes point, distinct
        // from the Automation model, proves neither module re-exports the other's
        // type through this shared entry point.
        type ViewPoint = { beat: number; value: number; label: string };
        const raw: ViewPoint[] = [
            { beat: 0, value: 0, label: 'start' },
            { beat: 1, value: 0.5, label: 'mid' },
            { beat: 2, value: 1, label: 'end' },
        ];

        const thinned = simplifyGesturePoints(raw);

        expect(thinned).toEqual([
            { beat: 0, value: 0, label: 'start' },
            { beat: 2, value: 1, label: 'end' },
        ]);
    });
});
