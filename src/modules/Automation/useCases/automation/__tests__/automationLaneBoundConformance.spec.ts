import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    AUTOMATION_BOUND_CASES,
    type AutomationLaneBoundCase,
    CASE_FIRST_BEAT,
    CASE_NEXT_BEAT,
    CASE_PREVIOUS_BEAT,
    CASE_SECOND_BEAT,
    CONFORMANCE_SAMPLE_BEATS,
} from '#/utils/__tests__/automationCurveCases';
import { evaluateAutomationCurve } from '#/utils/automationCurve';
import { boundAutomationLaneValue } from '#/utils/automationLaneBound';

import { type AutomationPoint } from '../../../models/Automation';
import { automationStore, type AutomationLane } from '../../../stores/automationStore';
import { getAutomationLaneCeiling } from '../getAutomationLaneCeiling';
import { getAutomationValueAtBeat } from '../getAutomationValueAtBeat';

/**
 * #2539 lane-bound conformance gate — LIVE side. Do not delete without
 * replacing.
 *
 * The live apply path bounds every lane's interpolated value to the lane's
 * declared range inside `getAutomationValueAtBeat`, per segment, before the
 * link scale. The offline scheduler must apply the same law on the same
 * inputs — the mix you monitor is the mix you bounce. Until #2539 the law
 * existed only as this side's private `clampToLaneRange` plus a hand-maintained
 * offline transcription used by the gain branch alone; the two bodies could
 * drift with no gate between them (the exact shape that already bit the curve
 * math once — PR #616). The law now lives in one kernel
 * (`#/utils/automationLaneBound`); this spec pins the LIVE routing of that
 * kernel, its sibling in AudioEngine `offlineScheduler` pins the offline
 * routing, and `src/utils/__tests__/automationLaneBound.spec.ts` pins the law
 * itself. If either runtime re-forks its bound, one of these trips.
 *
 * Each case maps into a real store lane: the segment's stored points on beats
 * [0, 4] with `smooth` neighbours at -4/8 (curve-table geometry), so every
 * sampled beat is evaluated through the shared curve kernel exactly as the
 * lookup does, and the expectation is the shared bound applied to that raw
 * kernel value with the same bracketing pair — computed independently here, so
 * the spec observes the lookup rather than sharing its implementation.
 */

/**
 * The lane a case realizes. Rows whose derived ceiling exceeds the declared
 * maximum are the legacy-gain widening — the one lane shape
 * `getAutomationLaneCeiling` raises — so they must ride `parameterId: 'gain'`
 * with declared [0, 1]; every other row rides a neutral parameter whose
 * derived ceiling is its declared maximum.
 */
function laneFromCase(boundCase: AutomationLaneBoundCase): AutomationLane {
    const legacyGainWidening = boundCase.derivedCeiling > boundCase.declaredMax;
    const points: AutomationPoint[] = [
        { beat: CASE_PREVIOUS_BEAT, value: boundCase.previousValue, curve: 'linear', tension: 0 },
        { beat: CASE_FIRST_BEAT, value: boundCase.segmentFirstValue, curve: 'smooth', tension: 0 },
        { beat: CASE_SECOND_BEAT, value: boundCase.segmentSecondValue, curve: 'linear', tension: 0 },
        { beat: CASE_NEXT_BEAT, value: boundCase.nextValue, curve: 'linear', tension: 0 },
    ];
    return {
        id: `lane-${boundCase.name}`,
        trackId: 'track-1',
        parameterId: legacyGainWidening ? 'gain' : 'param-1',
        parameterName: 'Param',
        points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: boundCase.declaredMin,
        maxValue: boundCase.declaredMax,
    };
}

/**
 * The lane-bound value the live law produces at `beat`: the shared curve
 * kernel on the same bracketing + neighbour selection `getAutomationValueAtBeat`
 * uses (last point with beat <= target; endpoints hold), through the shared
 * bound. Replicating the lookup's bracket selection — rather than always
 * evaluating the [0, 4] segment — is what makes the shared endpoint beats
 * comparable: at beat 4 the lookup brackets with the NEXT segment, and a
 * 'smooth' segment's float error at fraction 1 differs from the following
 * segment's fraction 0.
 */
function boundedLiveValueAtBeat(boundCase: AutomationLaneBoundCase, beat: number): number {
    const points = [
        { beat: CASE_PREVIOUS_BEAT, value: boundCase.previousValue, curve: 'linear', tension: 0 },
        { beat: CASE_FIRST_BEAT, value: boundCase.segmentFirstValue, curve: 'smooth', tension: 0 },
        { beat: CASE_SECOND_BEAT, value: boundCase.segmentSecondValue, curve: 'linear', tension: 0 },
        { beat: CASE_NEXT_BEAT, value: boundCase.nextValue, curve: 'linear', tension: 0 },
    ];
    let beforeIdx = -1;
    for (let index = 0; index < points.length; index++) {
        if (points[index]!.beat <= beat) {
            beforeIdx = index;
        } else {
            break;
        }
    }
    if (beforeIdx === -1) {
        // Unreachable: the lane's first point is at beat -4 and every sampled
        // beat is at or after beat 0 — fail loudly rather than inventing a
        // value if that geometry ever changes.
        throw new Error('conformance probe before the first lane point');
    }
    const first = points[beforeIdx]!;
    const second = points[beforeIdx + 1] ?? first;
    const raw = evaluateAutomationCurve({
        firstPoint: first,
        secondPoint: second,
        beat,
        previousPoint: points[beforeIdx - 1],
        nextPoint: points[beforeIdx + 2],
    });
    return boundAutomationLaneValue({
        value: raw,
        declaredMin: boundCase.declaredMin,
        declaredMax: boundCase.declaredMax,
        derivedCeiling: boundCase.derivedCeiling,
        segmentFirstValue: first.value,
        segmentSecondValue: second.value,
    });
}

describe('automation lane-bound conformance — live lookup applies the shared bound', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });
    afterEach(() => {
        automationStore.set({ lanes: [] });
    });

    for (const boundCase of AUTOMATION_BOUND_CASES) {
        it(`"${boundCase.name}" — every sampled beat equals the shared bound on the shared kernel`, () => {
            const lane = laneFromCase(boundCase);
            automationStore.set({ lanes: [lane] });

            // The row is realizable on this side only if the live ceiling law
            // really derives the row's ceiling for this lane — assert that
            // first, or the rows below would silently pin a different law.
            expect(getAutomationLaneCeiling(lane)).toBe(boundCase.derivedCeiling);

            for (const beat of CONFORMANCE_SAMPLE_BEATS) {
                expect(getAutomationValueAtBeat(lane.id, beat), `case "${boundCase.name}" at beat ${beat}`).toBe(
                    boundedLiveValueAtBeat(boundCase, beat)
                );
            }
        });
    }

    it('bounds a held value with itself as its own bracket, before the first point', () => {
        // The held branches pass (held, held, held) to the bound: a stored
        // point drawn past the declared ceiling is played back — the ceiling
        // the segment's own points raise to admits the point itself — while a
        // lane with no such widening holds it at its declared maximum.
        const points: AutomationPoint[] = [{ beat: CASE_FIRST_BEAT, value: 1.5, curve: 'linear', tension: 0 }];
        const legacyGain: AutomationLane = {
            id: 'held-legacy-gain',
            trackId: 'track-1',
            parameterId: 'gain',
            parameterName: 'Volume',
            points,
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 1,
        };
        const plainLane: AutomationLane = { ...legacyGain, id: 'held-plain', parameterId: 'param-1' };

        automationStore.set({ lanes: [legacyGain, plainLane] });
        expect(getAutomationValueAtBeat('held-legacy-gain', CASE_FIRST_BEAT - 1)).toBe(1.5);
        expect(getAutomationValueAtBeat('held-plain', CASE_FIRST_BEAT - 1)).toBe(1);
    });
});
