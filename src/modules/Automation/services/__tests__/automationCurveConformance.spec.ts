import { describe, expect, it } from 'vitest';

import { evaluateAutomationCurve } from '#/utils/automationCurve';

import { type AutomationPoint } from '../../models/Automation';
import { interpolateAutomationPointValue } from '../automationPointAlgorithms';

/**
 * AU-1 cross-conformance gate — LIVE side. Do not delete without replacing.
 *
 * The live apply path and the offline compile path must evaluate the *same*
 * automation curve, or the mix you monitor is not the mix you bounce. PR #616
 * deleted the curve-conformance spec that guarded this and the two copies then
 * drifted (documented `stairs` clamping divergence). This spec pins the live
 * evaluator (`interpolateAutomationPointValue`) to the single shared kernel
 * (`#/utils/automationCurve`) that the offline compiler
 * (`compileAutomationEvents`) also routes through; its sibling on the offline
 * side pins that half. If either runtime re-forks the math, one of these trips.
 *
 * The kernel encodes the offline-aligned golden semantics (stairs clamped to an
 * integer in [2,32]); the assertions below that once diverged (`stairs` step
 * counts of 0 / 1 / fractional) are the red-first demonstration of AU-1: the
 * pre-collapse live copy returned NaN / off-by-a-step here while the offline
 * bounce clamped.
 */

type Segment = {
    firstPoint: AutomationPoint;
    secondPoint: AutomationPoint;
    previousPoint?: AutomationPoint;
    nextPoint?: AutomationPoint;
    beats: number[];
};

function point(overrides: Partial<AutomationPoint> = {}): AutomationPoint {
    return { beat: 0, value: 0, curve: 'linear', tension: 0, ...overrides };
}

const SAMPLE_BEATS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 3.9, 4];

const SEGMENTS: Record<string, Segment> = {
    linear: {
        firstPoint: point({ beat: 0, value: 0.2, curve: 'linear' }),
        secondPoint: point({ beat: 4, value: 0.9 }),
        beats: SAMPLE_BEATS,
    },
    step: {
        firstPoint: point({ beat: 0, value: 0.3, curve: 'step' }),
        secondPoint: point({ beat: 4, value: 0.9, curve: 'step' }),
        beats: SAMPLE_BEATS,
    },
    'stairs-default': {
        firstPoint: point({ beat: 0, value: 0, curve: 'stairs' }),
        secondPoint: point({ beat: 4, value: 1 }),
        beats: SAMPLE_BEATS,
    },
    'stairs-8': {
        firstPoint: point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 8 }),
        secondPoint: point({ beat: 4, value: 1 }),
        beats: SAMPLE_BEATS,
    },
    // AU-1 divergence demonstrators: pre-collapse the live copy did not clamp or
    // truncate stairSteps — 0 produced NaN, 1 stepped differently, and a
    // fractional count stepped on a non-integer grid — while offline clamped.
    'stairs-zero': {
        firstPoint: point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 0 }),
        secondPoint: point({ beat: 4, value: 1 }),
        beats: SAMPLE_BEATS,
    },
    'stairs-one': {
        firstPoint: point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 1 }),
        secondPoint: point({ beat: 4, value: 1 }),
        beats: SAMPLE_BEATS,
    },
    'stairs-fractional': {
        firstPoint: point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 2.7 }),
        secondPoint: point({ beat: 4, value: 1 }),
        beats: SAMPLE_BEATS,
    },
    'stairs-over-max': {
        firstPoint: point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 100 }),
        secondPoint: point({ beat: 4, value: 1 }),
        beats: SAMPLE_BEATS,
    },
    'exponential-pos': {
        firstPoint: point({ beat: 0, value: 0, curve: 'exponential', tension: 1 }),
        secondPoint: point({ beat: 4, value: 1 }),
        beats: SAMPLE_BEATS,
    },
    'exponential-neg': {
        firstPoint: point({ beat: 0, value: 0, curve: 'exponential', tension: -0.6 }),
        secondPoint: point({ beat: 4, value: 1 }),
        beats: SAMPLE_BEATS,
    },
    's-curve': {
        firstPoint: point({ beat: 0, value: 0, curve: 's-curve', tension: 0.5 }),
        secondPoint: point({ beat: 4, value: 1 }),
        beats: SAMPLE_BEATS,
    },
    smooth: {
        firstPoint: point({ beat: 0, value: 0.2, curve: 'smooth' }),
        secondPoint: point({ beat: 4, value: 0.8 }),
        previousPoint: point({ beat: -4, value: -0.1 }),
        nextPoint: point({ beat: 8, value: 1.2 }),
        beats: SAMPLE_BEATS,
    },
    'smooth-no-neighbors': {
        firstPoint: point({ beat: 0, value: 0.2, curve: 'smooth' }),
        secondPoint: point({ beat: 4, value: 0.8 }),
        beats: SAMPLE_BEATS,
    },
    bezier: {
        firstPoint: point({ beat: 0, value: 0, curve: 'bezier', cp1: { x: 0.25, y: 0.9 }, cp2: { x: 0.75, y: 0.1 } }),
        secondPoint: point({ beat: 4, value: 1 }),
        beats: SAMPLE_BEATS,
    },
    // Edge cases: zero-width and out-of-range beats.
    'zero-width': {
        firstPoint: point({ beat: 2, value: 0.5, curve: 'linear' }),
        secondPoint: point({ beat: 2, value: 0.9, curve: 'linear' }),
        beats: [1, 2, 3],
    },
    'out-of-range': {
        firstPoint: point({ beat: 1, value: 0.1, curve: 'linear' }),
        secondPoint: point({ beat: 3, value: 0.9 }),
        beats: [-2, 0, 5, 10],
    },
};

describe('automation curve conformance — live evaluator matches the shared kernel', () => {
    for (const [name, segment] of Object.entries(SEGMENTS)) {
        it(`"${name}" is sample-identical to evaluateAutomationCurve across the segment`, () => {
            for (const beat of segment.beats) {
                const live = interpolateAutomationPointValue({
                    firstPoint: segment.firstPoint,
                    secondPoint: segment.secondPoint,
                    beat,
                    previousPoint: segment.previousPoint,
                    nextPoint: segment.nextPoint,
                });
                const shared = evaluateAutomationCurve({
                    firstPoint: segment.firstPoint,
                    secondPoint: segment.secondPoint,
                    beat,
                    previousPoint: segment.previousPoint,
                    nextPoint: segment.nextPoint,
                });
                expect(live, `curve "${name}" at beat ${beat}`).toBe(shared);
            }
        });
    }
});
