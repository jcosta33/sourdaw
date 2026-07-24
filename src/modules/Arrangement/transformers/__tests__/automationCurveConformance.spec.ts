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

import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { interpolateAutomationValue } from '../automationTransformers';

/**
 * AU-1 cross-conformance gate — editor-readout side. Do not delete without replacing.
 *
 * `interpolateAutomationValue` is the third automation curve-value evaluator
 * (it feeds AutomationLaneRow's playhead value readout). It must agree with the
 * playback kernel (`#/utils/automationCurve`) or the number shown under the
 * cursor disagrees with what plays and bounces. Before this was folded onto the
 * kernel it was a fourth independent copy — and a lossy one: it clamped nothing
 * (`stairs` step counts of 0 / 1 / fractional / >32 went straight through) and
 * had no `bezier` branch at all (bezier lanes silently read as linear). This
 * spec pins it to the shared kernel across the same case table the live and
 * offline conformance specs use; if it re-forks, this trips.
 */

function pointsFromCase(curveCase: AutomationCurveCase): {
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

describe('automation curve conformance — editor readout matches the shared kernel', () => {
    for (const curveCase of AUTOMATION_CURVE_CASES) {
        it(`"${curveCase.name}" is sample-identical to evaluateAutomationCurve across the segment`, () => {
            const { firstPoint, secondPoint, previousPoint, nextPoint } = pointsFromCase(curveCase);
            for (const beat of CONFORMANCE_SAMPLE_BEATS) {
                const readout = interpolateAutomationValue(firstPoint, secondPoint, beat, previousPoint, nextPoint);
                const shared = evaluateAutomationCurve({ firstPoint, secondPoint, beat, previousPoint, nextPoint });
                expect(readout, `curve "${curveCase.name}" at beat ${beat}`).toBe(shared);
            }
        });
    }
});
