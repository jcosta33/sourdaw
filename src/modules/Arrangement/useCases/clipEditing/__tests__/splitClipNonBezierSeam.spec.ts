import { describe, it, expect, beforeEach } from 'vitest';

import { getAutomationValueAtBeat, restoreAutomationSnapshot } from '#/modules/Automation/useCases';

import { prepareClipSplitSatellites } from '../splitClipSatellites';

/**
 * #4078 — the non-bezier shaped families (`exponential`, `stairs`, `smooth`)
 * inherit the straddling segment's curve family on the seam, but their shape
 * laws are fraction functions that do not survive the split's span re-basing,
 * so no parameter assignment replays the pre-split continuation exactly (the
 * derivation lives on `seamPointFor`; `bezier` is the one exact family,
 * pinned by `splitClipBezierExactness.spec.ts`). What a split must still
 * guarantee is pinned here: the seam value is the exact pre-split sample at
 * the cut, the family fields travel, and each fragment stays inside the
 * family's documented residual envelope at every beat at or right of the cut.
 */

/**
 * Exponential's accepted seam residual as a fraction of the straddling
 * segment's |value| span. The power warp is not closed under the re-basing,
 * so the fragment replays a power of the LOCAL fraction where the source
 * played a power of the global one; sweeping every cut and every legal
 * |tension| ≤ 1 measures a worst disagreement of 0.417·span, reached at
 * tension ±1 (the drift vanishes as tension enters the ±0.01 linear
 * deadzone). 0.42·span is that envelope.
 */
const EXPONENTIAL_SEAM_RESIDUAL = 0.42;

/**
 * Stairs' accepted seam residual as a fraction of the straddling segment's
 * |value| span for step counts ≥ 4: the fragment's uniform steps cannot
 * align with the surviving misaligned edges, leaving at most about a
 * one-step disagreement — measured worst exactly span/4 across all cuts at
 * 4 steps (sampled on a shifted edge). Every legal count together (2–32)
 * measures span/2, at the 2-step minimum. 0.26·span pins the ≥ 4 envelope.
 */
const STAIRS_SEAM_RESIDUAL = 0.26;

/**
 * Smooth's accepted seam residual as a fraction of the Catmull-Rom
 * neighborhood's value spread — the largest |value| gap among the four
 * values feeding the straddling segment and its successor. The clamped
 * phantom tangent perturbs the two affected cubics by a Hermite basis factor
 * (≤ 4/27) of the tangent gaps; sweeping representative lanes and cuts
 * measures a worst of 0.074·spread, so 0.15·spread pins it with margin.
 */
const SMOOTH_SEAM_RESIDUAL = 0.15;

type SeamSpecPoint = {
    beat: number;
    value: number;
    curve: 'exponential' | 'stairs' | 'smooth';
    tension?: number;
    stairSteps?: number;
};

function clipLane(input: { id: string; points: SeamSpecPoint[] }) {
    return {
        id: input.id,
        trackId: 'track-1',
        clipId: 'c1',
        parameterId: 'gain',
        parameterName: 'Gain',
        points: input.points.map((point) => ({ tension: 0, ...point })),
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function planFor(absoluteSplitBeats: number) {
    return prepareClipSplitSatellites({
        clipId: 'c1',
        rightClipId: 'c2',
        clipRelativeSplitBeats: absoluteSplitBeats,
        contentSplitBeats: absoluteSplitBeats,
        absoluteSplitBeats,
    });
}

/** Beats 0 → 11 in twentieths: both fragment spans, the segment ends, the held flanks. */
const SWEEP = Array.from({ length: 221 }, (_, index) => index * 0.05);

function sweepLane(laneId: string): (number | null)[] {
    return SWEEP.map((beat) => getAutomationValueAtBeat(laneId, beat));
}

function expectSweepWithin(
    actual: (number | null)[],
    expected: (number | null)[],
    cutBeat: number,
    epsilon: number
): void {
    for (let index = 0; index < SWEEP.length; index += 1) {
        const beat = SWEEP[index]!;
        if (beat < cutBeat) {
            continue;
        }
        const expectedValue = expected[index];
        const actualValue = actual[index];
        expect(expectedValue, `pre-split value at beat ${beat}`).not.toBeNull();
        expect(actualValue, `fragment value at beat ${beat}`).not.toBeNull();
        expect(Math.abs(actualValue! - expectedValue!), `seam residual at beat ${beat}`).toBeLessThan(epsilon);
    }
}

describe('split seam non-bezier curve families (#4078)', () => {
    beforeEach(() => {
        restoreAutomationSnapshot({ lanes: [] });
    });

    it.each([0.7, -0.7])(
        'keeps an exponential seam exact at the cut and inside the documented drift (tension %s)',
        (tension) => {
            const sourcePoints: SeamSpecPoint[] = [
                { beat: 1, value: 0.2, curve: 'exponential', tension },
                { beat: 7, value: 0.8, curve: 'exponential', tension },
            ];
            restoreAutomationSnapshot({ lanes: [clipLane({ id: 'lane-1', points: sourcePoints })] });
            const beforeSplit = sweepLane('lane-1');
            const seamSample = getAutomationValueAtBeat('lane-1', 4);

            const plan = planFor(4);

            const seam = plan.rightAutomationLanes[0]!.points[0]!;
            expect(seam.curve).toBe('exponential');
            expect(seam.tension).toBe(tension);
            // The seam value IS the pre-split warped sample at the cut,
            // bit-for-bit: the split stays continuous where it cuts.
            expect(seam.value).toBe(seamSample);

            // LEFT fragment: the source lane is untouched — identical doubles.
            const leftFragment = sweepLane('lane-1');
            expect(leftFragment).toEqual(beforeSplit);

            // RIGHT fragment: interior shape drifts, but never past the
            // family's documented envelope over the whole surviving span.
            restoreAutomationSnapshot({ lanes: [plan.rightAutomationLanes[0]!] });
            expectSweepWithin(
                sweepLane('auto-split-c2-0'),
                beforeSplit,
                4,
                EXPONENTIAL_SEAM_RESIDUAL * Math.abs(0.8 - 0.2)
            );
        }
    );

    it('keeps a stairs seam exact at a mid-step cut and inside the documented drift', () => {
        const sourcePoints: SeamSpecPoint[] = [
            { beat: 1, value: 0.2, curve: 'stairs', stairSteps: 4 },
            { beat: 7, value: 0.8, curve: 'stairs', stairSteps: 4 },
        ];
        restoreAutomationSnapshot({ lanes: [clipLane({ id: 'lane-1', points: sourcePoints })] });
        const beforeSplit = sweepLane('lane-1');
        // Beat 2.8 is fraction 0.3 of the 1→7 segment: 1.2 of 4 steps — the
        // cut lands INSIDE the second step, the misalignment case, and the
        // seam pins the exact stepped value 0.2 + 0.6·(1/4).
        const seamSample = getAutomationValueAtBeat('lane-1', 2.8);
        expect(seamSample).toBeCloseTo(0.35, 12);

        const plan = planFor(2.8);

        const seam = plan.rightAutomationLanes[0]!.points[0]!;
        expect(seam.curve).toBe('stairs');
        expect(seam.stairSteps).toBe(4);
        expect(seam.value).toBe(seamSample);

        const leftFragment = sweepLane('lane-1');
        expect(leftFragment).toEqual(beforeSplit);

        restoreAutomationSnapshot({ lanes: [plan.rightAutomationLanes[0]!] });
        expectSweepWithin(sweepLane('auto-split-c2-0'), beforeSplit, 2.8, STAIRS_SEAM_RESIDUAL * Math.abs(0.8 - 0.2));
    });

    it('keeps a stairs seam exact at a step-boundary cut too, under the declined realignment', () => {
        const sourcePoints: SeamSpecPoint[] = [
            { beat: 1, value: 0.2, curve: 'stairs', stairSteps: 4 },
            { beat: 7, value: 0.8, curve: 'stairs', stairSteps: 4 },
        ];
        restoreAutomationSnapshot({ lanes: [clipLane({ id: 'lane-1', points: sourcePoints })] });
        const beforeSplit = sweepLane('lane-1');
        // Beat 4 is fraction 0.5 of the segment — exactly 2.0 of 4 steps, an
        // interior step edge. Exactness there would demand stairSteps 2, the
        // realignment `seamPointFor` documents and declines (it would rewrite
        // the authored count), so the inherited count plays and the same
        // envelope applies.
        const seamSample = getAutomationValueAtBeat('lane-1', 4);
        expect(seamSample).toBeCloseTo(0.5, 12);

        const plan = planFor(4);

        const seam = plan.rightAutomationLanes[0]!.points[0]!;
        expect(seam.curve).toBe('stairs');
        expect(seam.stairSteps).toBe(4);
        expect(seam.value).toBe(seamSample);

        restoreAutomationSnapshot({ lanes: [plan.rightAutomationLanes[0]!] });
        expectSweepWithin(sweepLane('auto-split-c2-0'), beforeSplit, 4, STAIRS_SEAM_RESIDUAL * Math.abs(0.8 - 0.2));
    });

    it('keeps a smooth seam exact at the cut and inside the documented drift, with no phantom carry', () => {
        // The predecessor and successor values feed the straddling segment's
        // Catmull-Rom tangents, so the fixture carries real points on both
        // sides of it.
        const sourcePoints: SeamSpecPoint[] = [
            { beat: 0, value: 0.9, curve: 'smooth' },
            { beat: 2, value: 0.2, curve: 'smooth' },
            { beat: 8, value: 0.7, curve: 'smooth' },
            { beat: 10, value: 0.4, curve: 'smooth' },
        ];
        restoreAutomationSnapshot({ lanes: [clipLane({ id: 'lane-1', points: sourcePoints })] });
        const beforeSplit = sweepLane('lane-1');
        const seamSample = getAutomationValueAtBeat('lane-1', 5);

        const plan = planFor(5);

        // The seam stays the plain family-carrying point. The phantom left
        // neighbor exactness would need is not representable in the point
        // model, and minting a field for it would change every consumer's
        // point shape for a residual that stays bounded anyway.
        expect(plan.rightAutomationLanes[0]!.points[0]).toEqual({
            id: 'asp-split-c2-0',
            beat: 5,
            value: seamSample,
            curve: 'smooth',
            tension: 0,
        });

        const leftFragment = sweepLane('lane-1');
        expect(leftFragment).toEqual(beforeSplit);

        // The neighborhood spread is the largest value gap among the four
        // points: |0.9 − 0.2|.
        restoreAutomationSnapshot({ lanes: [plan.rightAutomationLanes[0]!] });
        expectSweepWithin(sweepLane('auto-split-c2-0'), beforeSplit, 5, SMOOTH_SEAM_RESIDUAL * 0.7);
    });
});
