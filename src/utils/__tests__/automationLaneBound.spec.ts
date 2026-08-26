import { describe, expect, it } from 'vitest';

import { boundAutomationLaneValue } from '../automationLaneBound';

import { AUTOMATION_BOUND_CASES, type AutomationLaneBoundCase } from './automationCurveCases';

/**
 * The law half of the #2539 lane-bound conformance gate. Do not delete without
 * replacing.
 *
 * `boundAutomationLaneValue` is the single kernel both runtimes route through —
 * the live lookup (`getAutomationValueAtBeat`) and every branch of the offline
 * scheduler (`automationScheduling`). Sharing the function makes live ==
 * offline by construction, but only while both sides keep routing through it;
 * the sibling conformance specs (Automation `useCases` and AudioEngine
 * `offlineScheduler` `automationLaneBoundConformance.spec.ts`) pin that routing,
 * and this spec pins the law itself against the shared case table
 * (`AUTOMATION_BOUND_CASES`): a row's `expected` is the one value the law may
 * produce, so a behavioural change to the kernel trips here even if both sides
 * move together — which would be a silent change to every saved project's
 * playback and bounce, not a refactor.
 */

function applyCase(boundCase: AutomationLaneBoundCase, value: number): number {
    return boundAutomationLaneValue({
        value,
        declaredMin: boundCase.declaredMin,
        declaredMax: boundCase.declaredMax,
        derivedCeiling: boundCase.derivedCeiling,
        segmentFirstValue: boundCase.segmentFirstValue,
        segmentSecondValue: boundCase.segmentSecondValue,
    });
}

describe('boundAutomationLaneValue — the shared lane-bound law', () => {
    for (const boundCase of AUTOMATION_BOUND_CASES) {
        it(`"${boundCase.name}" produces exactly the row's expected value`, () => {
            expect(applyCase(boundCase, boundCase.value)).toBe(boundCase.expected);
        });
    }

    it('keeps every raw value inside [declaredMin, raised ceiling], or passes it through untouched when the range is non-finite', () => {
        // The same rows, swept across raw values rather than the one probe:
        // the law's output domain is always the declared floor to the ceiling
        // the row's bracket can raise to — min(derived, highest stored point),
        // never below the declared ceiling.
        for (const boundCase of AUTOMATION_BOUND_CASES) {
            const finiteRange = Number.isFinite(boundCase.declaredMin) && Number.isFinite(boundCase.declaredMax);
            const highestStored = Math.max(boundCase.segmentFirstValue, boundCase.segmentSecondValue);
            const ceiling = Math.max(boundCase.declaredMax, Math.min(boundCase.derivedCeiling, highestStored));
            for (let raw = -3; raw <= 3; raw += 0.25) {
                const bounded = applyCase(boundCase, raw);
                if (!finiteRange) {
                    expect(bounded, `"${boundCase.name}" raw ${raw}`).toBe(raw);
                } else {
                    expect(bounded, `"${boundCase.name}" raw ${raw}`).toBeGreaterThanOrEqual(boundCase.declaredMin);
                    expect(bounded, `"${boundCase.name}" raw ${raw}`).toBeLessThanOrEqual(ceiling);
                }
            }
        }
    });
});
