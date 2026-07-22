import { describe, expect, it } from 'vitest';

import { compileAutomationSegments } from '../compileAutomationSegments';

describe('compileAutomationSegments', () => {
    it('holds step curves until the next frame-addressed point', () => {
        expect(
            compileAutomationSegments(
                [
                    { beat: 0, value: 0.25, curve: 'step', tension: 0 },
                    { beat: 2, value: 0.75, curve: 'linear', tension: 0 },
                ],
                2,
                120,
                [],
                1_000
            )
        ).toEqual([
            { startFrame: 0, endFrame: 1_000, startValue: 0.25, endValue: 0.25 },
            { startFrame: 1_000, endFrame: 1_000, startValue: 0.75, endValue: 0.75 },
        ]);
    });

    it('samples quadratic curves into bounded linear segments', () => {
        const segments = compileAutomationSegments(
            [
                { beat: 0, value: 0, curve: 'exponential', tension: 0 },
                { beat: 2, value: 1, curve: 'linear', tension: 0 },
            ],
            1,
            120,
            [],
            100
        );

        expect(segments).toHaveLength(101);
        expect(segments[0]).toEqual({ startFrame: 0, endFrame: 1, startValue: 0, endValue: 0.0001 });
        expect(segments.at(-1)).toEqual({ startFrame: 100, endFrame: 100, startValue: 1, endValue: 1 });
    });

    it('projects tempo changes into absolute render frames', () => {
        const segments = compileAutomationSegments(
            [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 4, value: 1, curve: 'linear', tension: 0 },
            ],
            4,
            120,
            [{ beat: 2, tempo: 60 }],
            100
        );

        expect(segments[0]?.endFrame).toBe(300);
    });

    it('does not jump to points beyond the render boundary', () => {
        expect(
            compileAutomationSegments(
                [
                    { beat: 4, value: 0.2, curve: 'step', tension: 0 },
                    { beat: 8, value: 0.9, curve: 'step', tension: 0 },
                ],
                1,
                120,
                [],
                100
            )
        ).toEqual([{ startFrame: 0, endFrame: 100, startValue: 0.2, endValue: 0.2 }]);
    });
});
