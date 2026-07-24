import { describe, expect, it } from 'vitest';

import { AUTOMATION_CURVE_CASES, CASE_FIRST_BEAT, CASE_SECOND_BEAT } from '#/utils/__tests__/automationCurveCases';
import { evaluateAutomationCurve } from '#/utils/automationCurve';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { compileAutomationEvents } from '../compileAutomationEvents';

/**
 * AU-1 cross-conformance gate — OFFLINE side. Do not delete without replacing.
 *
 * The offline compiler (`compileAutomationEvents`) and the live apply path —
 * the two runtimes finding AU-1 audited — must evaluate the *same* automation
 * curve, or the bounce differs from what was monitored. PR #616 deleted the
 * curve-conformance spec that guarded this and the two copies drifted (`stairs`
 * clamping). This spec drives the real offline compiler and asserts every
 * emitted sample equals the single shared kernel (`#/utils/automationCurve`,
 * which the live evaluator also routes through), evaluated with the same
 * bracketing the live lookup (`getAutomationValueAtBeat`) uses. Its sibling on
 * the live side pins that half. Both consume one shared case table
 * (`#/utils/__tests__/automationCurveCases`). If either runtime re-forks the
 * curve math, one of these specs trips.
 *
 * A neutral identity beat→seconds projector is injected so an emitted event's
 * `timeSeconds` is exactly its beat, making the offline sample directly
 * comparable to the kernel value at that beat. Each case is mapped to a
 * two-point lane on beats [0, 4]; the offline compiler derives `smooth`
 * neighbors from the lane, so no explicit neighbor points are needed here.
 */

const DEFAULT_TEMPO = 120;
const NO_CHANGES: { beat: number; tempo: number }[] = [];
const LANE_DURATION_SECONDS = CASE_SECOND_BEAT - CASE_FIRST_BEAT;

function identityProjector(beat: number): number {
    return beat;
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

describe('automation curve conformance — offline compiler matches the shared kernel', () => {
    for (const curveCase of AUTOMATION_CURVE_CASES) {
        it(`"${curveCase.name}" — every compiled sample equals the shared kernel at its beat`, () => {
            const points: AutomationPoint[] = [
                {
                    beat: CASE_FIRST_BEAT,
                    value: curveCase.startValue,
                    curve: curveCase.curve,
                    tension: curveCase.tension ?? 0,
                    stairSteps: curveCase.stairSteps,
                    cp1: curveCase.cp1,
                    cp2: curveCase.cp2,
                },
                {
                    beat: CASE_SECOND_BEAT,
                    value: curveCase.endValue,
                    curve: curveCase.curve,
                    tension: curveCase.tension ?? 0,
                },
            ];
            const events = compileAutomationEvents(
                points,
                LANE_DURATION_SECONDS,
                DEFAULT_TEMPO,
                NO_CHANGES,
                0,
                identityProjector
            );
            expect(events.length).toBeGreaterThan(0);
            for (const event of events) {
                // Identity projector → event.timeSeconds is the beat.
                const expected = liveValueAtBeat(points, event.timeSeconds);
                expect(
                    Number.isFinite(event.value),
                    `curve "${curveCase.name}" sample at beat ${event.timeSeconds}`
                ).toBe(true);
                expect(event.value, `curve "${curveCase.name}" sample at beat ${event.timeSeconds}`).toBeCloseTo(
                    expected,
                    8
                );
            }
        });
    }
});
