import { describe, expect, it } from 'vitest';

import {
    AUTOMATION_CURVE_CASES,
    type AutomationCurveCase,
    CASE_FIRST_BEAT,
    CASE_NEXT_BEAT,
    CASE_PREVIOUS_BEAT,
    CASE_SECOND_BEAT,
    CONFORMANCE_SAMPLE_BEATS,
} from '#/utils/__tests__/automationCurveCases';
import { evaluateAutomationCurve } from '#/utils/automationCurve';

import { type AutomationPoint } from '../../models/Automation';
import { interpolateAutomationPointValue } from '../automationPointAlgorithms';

/**
 * AU-1 cross-conformance gate — LIVE side. Do not delete without replacing.
 *
 * The live apply path and the offline compile path — the two runtimes finding
 * AU-1 audited — must evaluate the *same* automation curve, or the mix you
 * monitor is not the mix you bounce. PR #616 deleted the curve-conformance spec
 * that guarded this and the two copies then drifted (documented `stairs`
 * clamping divergence). This spec pins the live evaluator
 * (`interpolateAutomationPointValue`) to the single shared kernel
 * (`#/utils/automationCurve`) that the offline compiler
 * (`compileAutomationEvents`) also routes through; its sibling on the offline
 * side pins that half. If either runtime re-forks the math, one of these trips.
 * Both consume one shared case table (`#/utils/__tests__/automationCurveCases`).
 *
 * The kernel encodes the offline-aligned golden semantics (stairs clamped to an
 * integer in [2,32]); the cases that once diverged (`stairs` step counts of 0 /
 * 1 / fractional / >32) are the red-first demonstration of AU-1: the
 * pre-collapse live copy returned NaN / off-by-a-step there while the offline
 * bounce clamped.
 */

function pointFromCase(curveCase: AutomationCurveCase): {
    firstPoint: AutomationPoint;
    secondPoint: AutomationPoint;
    previousPoint?: AutomationPoint;
    nextPoint?: AutomationPoint;
} {
    const firstPoint: AutomationPoint = {
        beat: CASE_FIRST_BEAT,
        value: curveCase.startValue,
        curve: curveCase.curve,
        tension: curveCase.tension ?? 0,
        stairSteps: curveCase.stairSteps,
        cp1: curveCase.cp1,
        cp2: curveCase.cp2,
    };
    const secondPoint: AutomationPoint = {
        beat: CASE_SECOND_BEAT,
        value: curveCase.endValue,
        curve: curveCase.curve,
        tension: curveCase.tension ?? 0,
    };
    const previousPoint =
        curveCase.previousValue === undefined
            ? undefined
            : { beat: CASE_PREVIOUS_BEAT, value: curveCase.previousValue, curve: curveCase.curve, tension: 0 };
    const nextPoint =
        curveCase.nextValue === undefined
            ? undefined
            : { beat: CASE_NEXT_BEAT, value: curveCase.nextValue, curve: curveCase.curve, tension: 0 };
    return { firstPoint, secondPoint, previousPoint, nextPoint };
}

describe('automation curve conformance — live evaluator matches the shared kernel', () => {
    for (const curveCase of AUTOMATION_CURVE_CASES) {
        it(`"${curveCase.name}" is sample-identical to evaluateAutomationCurve across the segment`, () => {
            const { firstPoint, secondPoint, previousPoint, nextPoint } = pointFromCase(curveCase);
            for (const beat of CONFORMANCE_SAMPLE_BEATS) {
                const live = interpolateAutomationPointValue({
                    firstPoint,
                    secondPoint,
                    beat,
                    previousPoint,
                    nextPoint,
                });
                const shared = evaluateAutomationCurve({ firstPoint, secondPoint, beat, previousPoint, nextPoint });
                expect(live, `curve "${curveCase.name}" at beat ${beat}`).toBe(shared);
            }
        });
    }
});

describe('automation curve conformance — live evaluator segment guards', () => {
    it('holds the first value on a zero-width segment (same beat)', () => {
        const firstPoint: AutomationPoint = { beat: 2, value: 0.5, curve: 'linear', tension: 0 };
        const secondPoint: AutomationPoint = { beat: 2, value: 0.9, curve: 'linear', tension: 0 };
        for (const beat of [1, 2, 3]) {
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat })).toBe(
                evaluateAutomationCurve({ firstPoint, secondPoint, beat })
            );
        }
    });

    it('clamps out-of-range beats identically to the kernel (no extrapolation)', () => {
        const firstPoint: AutomationPoint = { beat: 1, value: 0.1, curve: 'linear', tension: 0 };
        const secondPoint: AutomationPoint = { beat: 3, value: 0.9, curve: 'linear', tension: 0 };
        for (const beat of [-2, 0, 5, 10]) {
            expect(interpolateAutomationPointValue({ firstPoint, secondPoint, beat })).toBe(
                evaluateAutomationCurve({ firstPoint, secondPoint, beat })
            );
        }
    });
});
