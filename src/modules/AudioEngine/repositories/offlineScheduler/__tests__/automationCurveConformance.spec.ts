import { describe, expect, it } from 'vitest';

import { evaluateAutomationCurve } from '#/utils/automationCurve';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { compileAutomationEvents } from '../compileAutomationEvents';

/**
 * AU-1 cross-conformance gate — OFFLINE side. Do not delete without replacing.
 *
 * The offline compiler (`compileAutomationEvents`) and the live apply path must
 * evaluate the *same* automation curve, or the bounce differs from what was
 * monitored. PR #616 deleted the curve-conformance spec that guarded this and
 * the two copies drifted (`stairs` clamping). This spec drives the real offline
 * compiler and asserts every emitted sample equals the single shared kernel
 * (`#/utils/automationCurve`, which the live evaluator also routes through),
 * evaluated with the same bracketing the live lookup (`getAutomationValueAtBeat`)
 * uses. Its sibling on the live side pins that half. If either runtime re-forks
 * the curve math, one of these specs trips.
 *
 * A neutral identity beat→seconds projector is injected so an emitted event's
 * `timeSeconds` is exactly its beat, making the offline sample directly
 * comparable to the kernel value at that beat.
 */

const DEFAULT_TEMPO = 120;
const NO_CHANGES: { beat: number; tempo: number }[] = [];
function identityProjector(beat: number): number {
    return beat;
}

function point(
    beat: number,
    value: number,
    curve: AutomationPoint['curve'] = 'linear',
    extra: Partial<AutomationPoint> = {}
): AutomationPoint {
    return { beat, value, curve, tension: 0, ...extra };
}

/**
 * Live-lookup value at a beat: the same bracketing + neighbor selection as
 * `getAutomationValueAtBeat` (last point with beat <= target; endpoints hold),
 * evaluated through the shared kernel. Points must be sorted by beat.
 */
function liveValueAtBeat(points: AutomationPoint[], beat: number): number {
    let beforeIdx = -1;
    for (let index = 0; index < points.length; index++) {
        if (points[index]!.beat <= beat) {
            beforeIdx = index;
        } else {
            break;
        }
    }
    if (beforeIdx === -1) {
        return points[0]!.value;
    }
    if (beforeIdx === points.length - 1) {
        return points[beforeIdx]!.value;
    }
    return evaluateAutomationCurve({
        firstPoint: points[beforeIdx]!,
        secondPoint: points[beforeIdx + 1]!,
        beat,
        previousPoint: points[beforeIdx - 1],
        nextPoint: points[beforeIdx + 2],
    });
}

type Lane = {
    points: AutomationPoint[];
    durationSeconds: number;
};

const LANES: Record<string, Lane> = {
    linear: { points: [point(0, 0.2), point(4, 0.9)], durationSeconds: 4 },
    step: { points: [point(0, 0.3, 'step'), point(4, 0.9, 'step')], durationSeconds: 4 },
    'stairs-default': { points: [point(0, 0, 'stairs'), point(4, 1)], durationSeconds: 4 },
    'stairs-8': { points: [point(0, 0, 'stairs', { stairSteps: 8 }), point(4, 1)], durationSeconds: 4 },
    // AU-1 demonstrators: these stairSteps values were the drift point. The
    // offline path clamps them; this asserts the shared kernel (hence the live
    // path too, post-collapse) produces the identical clamped stepping.
    'stairs-zero': { points: [point(0, 0, 'stairs', { stairSteps: 0 }), point(4, 1)], durationSeconds: 4 },
    'stairs-one': { points: [point(0, 0, 'stairs', { stairSteps: 1 }), point(4, 1)], durationSeconds: 4 },
    'stairs-fractional': { points: [point(0, 0, 'stairs', { stairSteps: 2.7 }), point(4, 1)], durationSeconds: 4 },
    'stairs-over-max': { points: [point(0, 0, 'stairs', { stairSteps: 100 }), point(32, 1)], durationSeconds: 32 },
    'exponential-pos': { points: [point(0, 0, 'exponential', { tension: 1 }), point(4, 1)], durationSeconds: 4 },
    'exponential-neg': { points: [point(0, 0, 'exponential', { tension: -0.6 }), point(4, 1)], durationSeconds: 4 },
    's-curve': { points: [point(0, 0, 's-curve', { tension: 0.5 }), point(4, 1)], durationSeconds: 4 },
    'smooth-multi': {
        points: [point(0, 0, 'smooth'), point(1, 0.3, 'smooth'), point(3, 0.7, 'smooth'), point(4, 1, 'smooth')],
        durationSeconds: 4,
    },
    bezier: {
        points: [point(0, 0, 'bezier', { cp1: { x: 0.25, y: 0.9 }, cp2: { x: 0.75, y: 0.1 } }), point(4, 1)],
        durationSeconds: 4,
    },
};

describe('automation curve conformance — offline compiler matches the shared kernel', () => {
    for (const [name, lane] of Object.entries(LANES)) {
        it(`"${name}" — every compiled sample equals the shared kernel at its beat`, () => {
            const events = compileAutomationEvents(
                lane.points,
                lane.durationSeconds,
                DEFAULT_TEMPO,
                NO_CHANGES,
                0,
                identityProjector
            );
            expect(events.length).toBeGreaterThan(0);
            for (const event of events) {
                // Identity projector → event.timeSeconds is the beat.
                const expected = liveValueAtBeat(lane.points, event.timeSeconds);
                expect(Number.isFinite(event.value), `curve "${name}" sample at beat ${event.timeSeconds}`).toBe(true);
                expect(event.value, `curve "${name}" sample at beat ${event.timeSeconds}`).toBeCloseTo(expected, 8);
            }
        });
    }
});
