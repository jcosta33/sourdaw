import { describe, expect, it } from 'vitest';

import { type AutomationCurvePoint, evaluateAutomationCurve } from '../automationCurve';

/**
 * Golden-value lock for the shared automation curve kernel (finding AU-1).
 *
 * This is the canonical behaviour BOTH runtimes are pinned to: the live apply
 * path (Automation `interpolateAutomationPointValue`) and the offline compile
 * path (AudioEngine `compileAutomationEvents`) evaluate every curve through
 * `evaluateAutomationCurve`. The two former hand-maintained copies had drifted
 * on `stairs` clamping; these values encode the converged golden standard
 * (clamped, defended). The per-runtime conformance specs assert each side still
 * matches this kernel — see:
 *   - src/modules/Automation/services/__tests__/automationCurveConformance.spec.ts
 *   - src/modules/AudioEngine/repositories/offlineScheduler/__tests__/automationCurveConformance.spec.ts
 */

function point(overrides: Partial<AutomationCurvePoint> = {}): AutomationCurvePoint {
    return { beat: 0, value: 0, curve: 'linear', ...overrides };
}

describe('evaluateAutomationCurve — segment guards', () => {
    it('holds the first value on a zero-width segment (same beat)', () => {
        const firstPoint = point({ beat: 2, value: 5 });
        const secondPoint = point({ beat: 2, value: 99 });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 2 })).toBe(5);
    });

    it('holds the first value on a reversed segment (second beat before first)', () => {
        const firstPoint = point({ beat: 4, value: 5, curve: 'linear' });
        const secondPoint = point({ beat: 1, value: 99, curve: 'linear' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 2 })).toBe(5);
    });

    it('clamps the segment fraction so an out-of-range beat does not extrapolate', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 'linear' });
        const secondPoint = point({ beat: 4, value: 8, curve: 'linear' });
        // beat 8 → raw fraction 2.0; clamped to 1.0 → holds the endpoint value.
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 8 })).toBe(8);
        // beat -4 → raw fraction -1.0; clamped to 0.0 → holds the start value.
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: -4 })).toBe(0);
    });
});

describe('evaluateAutomationCurve — linear', () => {
    it('interpolates linearly between the endpoints', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 'linear' });
        const secondPoint = point({ beat: 4, value: 8, curve: 'linear' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 1 })).toBe(2);
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 3 })).toBe(6);
    });
});

describe('evaluateAutomationCurve — step', () => {
    it('holds the first value across the whole segment', () => {
        const firstPoint = point({ beat: 0, value: 3, curve: 'step' });
        const secondPoint = point({ beat: 4, value: 9, curve: 'step' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 3.9 })).toBe(3);
    });
});

describe('evaluateAutomationCurve — stairs (AU-1 convergence: clamp to integer [2,32])', () => {
    it('quantizes into the default 4 steps when stairSteps is unset', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 'stairs' });
        const secondPoint = point({ beat: 8, value: 8, curve: 'stairs' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 1 })).toBe(0);
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 2 })).toBe(2);
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 7 })).toBe(6);
    });

    it('honors a custom in-range stairSteps count', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 2 });
        const secondPoint = point({ beat: 4, value: 10, curve: 'stairs' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 1 })).toBe(0);
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 3 })).toBe(5);
    });

    it('clamps stairSteps below the minimum up to 2 (was NaN in the old live copy)', () => {
        const secondPoint = point({ beat: 4, value: 8, curve: 'stairs' });
        // steps 0 → clamp 2. beat 3 → fraction 0.75 → floor(1.5)/2 = 0.5 → value 4.
        const zero = point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 0 });
        expect(evaluateAutomationCurve({ firstPoint: zero, secondPoint, beat: 3 })).toBe(4);
        // steps 1 → clamp 2. Same result.
        const one = point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 1 });
        expect(evaluateAutomationCurve({ firstPoint: one, secondPoint, beat: 3 })).toBe(4);
    });

    it('truncates a fractional stairSteps to an integer count', () => {
        const secondPoint = point({ beat: 4, value: 8, curve: 'stairs' });
        // 2.7 → trunc 2. beat 3 → fraction 0.75 → floor(1.5)/2 = 0.5 → value 4.
        const fractional = point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 2.7 });
        expect(evaluateAutomationCurve({ firstPoint: fractional, secondPoint, beat: 3 })).toBe(4);
    });

    it('clamps stairSteps above the maximum down to 32', () => {
        const secondPoint = point({ beat: 32, value: 32, curve: 'stairs' });
        // steps 100 → clamp 32. beat 1 → fraction 1/32 → floor(1)/32 = 1/32 → value 1.
        const many = point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 100 });
        expect(evaluateAutomationCurve({ firstPoint: many, secondPoint, beat: 1 })).toBe(1);
    });
});

describe('evaluateAutomationCurve — exponential', () => {
    it('is linear inside the +/-0.01 tension deadzone', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 'exponential', tension: 0 });
        const secondPoint = point({ beat: 4, value: 8, curve: 'exponential' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 2 })).toBe(4);
    });

    it('holds back near the start for positive tension', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 'exponential', tension: 1 });
        const secondPoint = point({ beat: 4, value: 8, curve: 'exponential' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 2 })).toBeCloseTo(0.03125, 5);
    });

    it('rushes ahead early for negative tension', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 'exponential', tension: -1 });
        const secondPoint = point({ beat: 4, value: 8, curve: 'exponential' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 2 })).toBeCloseTo(7.336, 3);
    });

    it('defaults an absent tension to 0 → linear (was NaN in the old offline copy)', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 'exponential' });
        const secondPoint = point({ beat: 4, value: 8, curve: 'exponential' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 2 })).toBe(4);
    });
});

describe('evaluateAutomationCurve — s-curve', () => {
    it('degrades to linear at tension 0', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 's-curve', tension: 0 });
        const secondPoint = point({ beat: 4, value: 8, curve: 's-curve' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 1 })).toBe(2);
    });

    it('eases away from linear at partial tension', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 's-curve', tension: 0.5 });
        const secondPoint = point({ beat: 4, value: 8, curve: 's-curve' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 1 })).toBe(1.625);
    });

    it('reaches full smoothstep ease at tension 1', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 's-curve', tension: 1 });
        const secondPoint = point({ beat: 4, value: 8, curve: 's-curve' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 1 })).toBe(1.25);
    });

    it('defaults an absent tension to 0.5', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 's-curve' });
        const secondPoint = point({ beat: 4, value: 8, curve: 's-curve' });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 1 })).toBe(1.625);
    });
});

describe('evaluateAutomationCurve — smooth (Catmull-Rom)', () => {
    it('blends surrounding lane points when neighbors are provided', () => {
        const previousPoint = point({ beat: -4, value: -10 });
        const firstPoint = point({ beat: 0, value: 2, curve: 'smooth' });
        const secondPoint = point({ beat: 4, value: 8 });
        const nextPoint = point({ beat: 8, value: 20 });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 1, previousPoint, nextPoint })).toBeCloseTo(
            3.78125,
            10
        );
    });

    it('falls back to endpoint tangents when neighbors are absent', () => {
        const firstPoint = point({ beat: 0, value: 2, curve: 'smooth' });
        const secondPoint = point({ beat: 4, value: 8 });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 1 })).toBeCloseTo(3.21875, 10);
    });
});

describe('evaluateAutomationCurve — bezier', () => {
    it('is near-linear with default control points', () => {
        const firstPoint = point({ beat: 0, value: 0, curve: 'bezier' });
        const secondPoint = point({ beat: 4, value: 8 });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 2 })).toBeCloseTo(4.0451119318, 8);
    });

    it('passes exactly through the segment endpoints regardless of control points', () => {
        const firstPoint = point({
            beat: 0,
            value: 0,
            curve: 'bezier',
            cp1: { x: 0.25, y: 10 },
            cp2: { x: 0.75, y: -2 },
        });
        const secondPoint = point({ beat: 4, value: 8 });
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 0 })).toBe(0);
        expect(evaluateAutomationCurve({ firstPoint, secondPoint, beat: 4 })).toBe(8);
    });
});
