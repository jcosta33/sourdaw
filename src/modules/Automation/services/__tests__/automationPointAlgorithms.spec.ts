import { describe, expect, it } from 'vitest';

import { type AutomationPoint } from '../../models/Automation';
import { interpolateAutomationPointValue, simplifyAutomationPoints } from '../automationPointAlgorithms';

function point(overrides: Partial<AutomationPoint> = {}): AutomationPoint {
    return { beat: 0, value: 0, curve: 'linear', tension: 0, ...overrides };
}

describe('interpolateAutomationPointValue', () => {
    it('returns the first point value for a zero-width segment (same beat), ignoring the second point', () => {
        const firstPoint = point({ beat: 2, value: 5 });
        const secondPoint = point({ beat: 2, value: 99 });
        expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 2 })).toBe(5);
    });

    it('holds the first point value for the entire step segment', () => {
        const firstPoint = point({ beat: 0, value: 3, curve: 'step' });
        const secondPoint = point({ beat: 4, value: 9, curve: 'step' });
        expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 3.9 })).toBe(3);
    });

    it('falls back to plain linear interpolation for the default "linear" curve', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 'linear' });
        const secondPoint = point({ beat: 4, value: 8, curve: 'linear' });
        expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 1 })).toBe(2);
        expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 3 })).toBe(6);
    });

    describe('stairs curve', () => {
        it('quantizes into the default 4 steps when stairSteps is unset', () => {
            const firstPoint = point({ beat: 0, value: 0, curve: 'stairs' });
            const secondPoint = point({ beat: 8, value: 8, curve: 'stairs' });
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 1 })).toBe(0);
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 2 })).toBe(2);
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 7 })).toBe(6);
        });

        it('honors a custom stairSteps count', () => {
            const firstPoint = point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 2 });
            const secondPoint = point({ beat: 4, value: 10, curve: 'stairs' });
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 1 })).toBe(0);
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 3 })).toBe(5);
        });
    });

    describe('exponential curve', () => {
        it('behaves like a linear ramp when tension is within the +/-0.01 deadzone', () => {
            const firstPoint = point({ beat: 0, value: 0, curve: 'exponential', tension: 0 });
            const secondPoint = point({ beat: 4, value: 8, curve: 'exponential' });
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 2 })).toBe(4);
        });

        it('holds back near the start (slow attack) for positive tension', () => {
            const firstPoint = point({ beat: 0, value: 0, curve: 'exponential', tension: 1 });
            const secondPoint = point({ beat: 4, value: 8, curve: 'exponential' });
            // t=0.5 raised to power 2**(1*3)=8 collapses toward 0 — far below the linear midpoint.
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 2 })).toBeCloseTo(0.03125, 5);
        });

        it('rushes ahead early (fast attack, logarithmic) for negative tension', () => {
            const firstPoint = point({ beat: 0, value: 0, curve: 'exponential', tension: -1 });
            const secondPoint = point({ beat: 4, value: 8, curve: 'exponential' });
            // t=0.5 raised to power 2**(-1*3)=1/8 pushes above the linear midpoint.
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 2 })).toBeCloseTo(7.336, 3);
        });
    });

    describe('s-curve', () => {
        it('degrades to plain linear when tension is 0', () => {
            const firstPoint = point({ beat: 0, value: 0, curve: 's-curve', tension: 0 });
            const secondPoint = point({ beat: 4, value: 8, curve: 's-curve' });
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 1 })).toBe(2);
        });

        it('eases away from linear at partial tension', () => {
            const firstPoint = point({ beat: 0, value: 0, curve: 's-curve', tension: 0.5 });
            const secondPoint = point({ beat: 4, value: 8, curve: 's-curve' });
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 1 })).toBe(1.625);
        });

        it('reaches full smoothstep ease at tension 1', () => {
            const firstPoint = point({ beat: 0, value: 0, curve: 's-curve', tension: 1 });
            const secondPoint = point({ beat: 4, value: 8, curve: 's-curve' });
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 1 })).toBe(1.25);
        });
    });

    describe('smooth (Catmull-Rom) curve', () => {
        it('blends in the surrounding lane points when neighbors are provided', () => {
            const previousPoint = point({ beat: -4, value: -10 });
            const firstPoint = point({ beat: 0, value: 2, curve: 'smooth' });
            const secondPoint = point({ beat: 4, value: 8 });
            const nextPoint = point({ beat: 8, value: 20 });
            expect(
                interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 1, previousPoint, nextPoint })
            ).toBeCloseTo(3.78125, 10);
        });

        it('falls back to the segment endpoints as tangents when neighbors are absent (differs from the neighbor-aware result)', () => {
            const firstPoint = point({ beat: 0, value: 2, curve: 'smooth' });
            const secondPoint = point({ beat: 4, value: 8 });
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 1 })).toBeCloseTo(3.21875, 10);
        });
    });

    describe('bezier curve', () => {
        it('matches a near-linear result with default control points (0.33/0.66 x, endpoint y values)', () => {
            const firstPoint = point({ beat: 0, value: 0, curve: 'bezier' });
            const secondPoint = point({ beat: 4, value: 8 });
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 2 })).toBeCloseTo(4.0451119318, 8);
        });

        it('applies custom control points, including an overshoot beyond the endpoint values', () => {
            const firstPoint = point({
                beat: 0,
                value: 0,
                curve: 'bezier',
                cp1: { x: 0.25, y: 10 },
                cp2: { x: 0.75, y: -2 },
            });
            const secondPoint = point({ beat: 4, value: 8 });
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 2 })).toBeCloseTo(4, 10);
        });

        it('always passes exactly through the segment endpoints regardless of control points', () => {
            const firstPoint = point({
                beat: 0,
                value: 0,
                curve: 'bezier',
                cp1: { x: 0.25, y: 10 },
                cp2: { x: 0.75, y: -2 },
            });
            const secondPoint = point({ beat: 4, value: 8 });
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 0 })).toBe(0);
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat: 4 })).toBe(8);
        });
    });
});

describe('simplifyAutomationPoints', () => {
    it('returns the input array unchanged (by reference) when there are 2 or fewer points', () => {
        const empty: AutomationPoint[] = [];
        expect(simplifyAutomationPoints({ points: empty, tolerance: 1 })).toBe(empty);

        const twoPoints = [point({ beat: 0, value: 0 }), point({ beat: 4, value: 4 })];
        expect(simplifyAutomationPoints({ points: twoPoints, tolerance: 1 })).toBe(twoPoints);
    });

    it('drops a collinear middle point within tolerance', () => {
        const points = [point({ beat: 0, value: 0 }), point({ beat: 2, value: 0 }), point({ beat: 4, value: 0 })];
        expect(simplifyAutomationPoints({ points, tolerance: 0.5 })).toEqual([
            point({ beat: 0, value: 0 }),
            point({ beat: 4, value: 0 }),
        ]);
    });

    it('keeps a middle point whose deviation exceeds tolerance', () => {
        const points = [point({ beat: 0, value: 0 }), point({ beat: 2, value: 5 }), point({ beat: 4, value: 0 })];
        expect(simplifyAutomationPoints({ points, tolerance: 1 })).toEqual(points);
    });

    it('keeps a clear outlier while pruning near-collinear noise around it once tolerance covers the noise', () => {
        const points = [
            point({ beat: 0, value: 0 }),
            point({ beat: 1, value: 0.05 }),
            point({ beat: 2, value: 5 }),
            point({ beat: 3, value: -0.05 }),
            point({ beat: 4, value: 0 }),
        ];
        expect(simplifyAutomationPoints({ points, tolerance: 2 })).toEqual([
            point({ beat: 0, value: 0 }),
            point({ beat: 2, value: 5 }),
            point({ beat: 4, value: 0 }),
        ]);
    });

    it('re-measures noise against each recursive sub-segment baseline, not the original line', () => {
        // Same points/shape as above with a tighter tolerance: the outlier still
        // splits the run, but each recursive half then measures its own noise
        // point against its own (much steeper, local) baseline rather than the
        // original near-flat line — so both noise points now clear the bar too.
        const points = [
            point({ beat: 0, value: 0 }),
            point({ beat: 1, value: 0.05 }),
            point({ beat: 2, value: 5 }),
            point({ beat: 3, value: -0.05 }),
            point({ beat: 4, value: 0 }),
        ];
        expect(simplifyAutomationPoints({ points, tolerance: 0.5 })).toEqual(points);
    });

    it('falls back to direct euclidean distance for a zero-length baseline (first and last points coincide)', () => {
        const farMiddle = [point({ beat: 0, value: 0 }), point({ beat: 5, value: 100 }), point({ beat: 0, value: 0 })];
        expect(simplifyAutomationPoints({ points: farMiddle, tolerance: 1 })).toEqual(farMiddle);

        const closeMiddle = [
            point({ beat: 3, value: 3 }),
            point({ beat: 3.01, value: 3.01 }),
            point({ beat: 3, value: 3 }),
        ];
        expect(simplifyAutomationPoints({ points: closeMiddle, tolerance: 1 })).toEqual([
            point({ beat: 3, value: 3 }),
            point({ beat: 3, value: 3 }),
        ]);
    });
});
