import { describe, it, expect, beforeEach } from 'vitest';

import { getAutomationValueAtBeat, restoreAutomationSnapshot } from '#/modules/Automation/useCases';
import { resolveBezierControls, subdivideBezierRightHalf } from '#/utils/automationCurve';

import { prepareClipSplitSatellites } from '../splitClipSatellites';

/**
 * #4044 — a split must change NOTHING about what the automation played. PR
 * #4036 gave the seam point the straddling segment's curve family; for
 * `bezier` that still played the family-DEFAULT quad, because the authored
 * `cp1`/`cp2` were dropped. These specs pin the de Casteljau fix: the seam
 * carries the straddling segment's subdivided right half, and both fragments
 * evaluate, at every absolute beat, exactly what the source played before the
 * split (evaluator against evaluator, through the real plan path).
 */

/**
 * Exactness bound for fragment-vs-source evaluator sweeps. The subdivision is
 * exact to float64; the residual is the kernel's Newton x-solve, whose 1e-6
 * FRACTION tolerance the two evaluations reach along different trajectories,
 * leaving up to ~tolerance × segment slope of value disagreement (measured
 * worst case 1.3e-6 over representative quads and cuts; see the kernel spec's
 * matching bound). The #4044 defect itself shifts played values by 1e-2 and
 * up — four orders above this bound.
 */
const BEZIER_EXACTNESS_EPSILON = 5e-6;

type SeamSpecPoint = {
    beat: number;
    value: number;
    curve: 'bezier' | 'linear' | 'step' | 's-curve' | 'smooth';
    tension?: number;
    cp1?: { x: number; y: number };
    cp2?: { x: number; y: number };
};

const AUTHORED_CPS = { cp1: { x: 0.2, y: 0.35 }, cp2: { x: 0.75, y: 0.9 } };

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

/** Beats 0 → 10 in fiftieths: the segment, its held flanks, and the cut. */
const SWEEP = Array.from({ length: 201 }, (_, index) => index * 0.05);

function sweepLane(laneId: string): (number | null)[] {
    return SWEEP.map((beat) => getAutomationValueAtBeat(laneId, beat));
}

function expectSweepMatches(actual: (number | null)[], expected: (number | null)[]): void {
    for (let index = 0; index < SWEEP.length; index += 1) {
        const beat = SWEEP[index]!;
        const expectedValue = expected[index];
        const actualValue = actual[index];
        if (beat < 4) {
            continue;
        }
        expect(expectedValue, `pre-split value at beat ${beat}`).not.toBeNull();
        expect(actualValue, `fragment value at beat ${beat}`).not.toBeNull();
        expect(Math.abs(actualValue! - expectedValue!), `exactness at beat ${beat}`).toBeLessThan(
            BEZIER_EXACTNESS_EPSILON
        );
    }
}

describe('split seam bezier exactness (#4044)', () => {
    beforeEach(() => {
        restoreAutomationSnapshot({ lanes: [] });
    });

    it('plays an authored-cp bezier exactly on both fragments across the whole segment', () => {
        const sourcePoints: SeamSpecPoint[] = [
            { beat: 1, value: 0.2, curve: 'bezier', ...AUTHORED_CPS },
            { beat: 7, value: 0.8, curve: 'bezier' },
        ];
        restoreAutomationSnapshot({ lanes: [clipLane({ id: 'lane-1', points: sourcePoints })] });
        const beforeSplit = sweepLane('lane-1');

        const plan = planFor(4);

        // LEFT fragment: the source lane is untouched — same id, same points —
        // so it evaluates to the identical doubles it played before the split.
        const leftFragment = sweepLane('lane-1');
        expect(leftFragment).toEqual(beforeSplit);

        // The seam carries the subdivided right half of the straddling quad.
        const quad = resolveBezierControls({ firstPoint: sourcePoints[0]!, secondPoint: sourcePoints[1]! });
        const subdivision = subdivideBezierRightHalf({ ...quad, y0: 0.2, y3: 0.8, cutFraction: 0.5 });
        const seam = plan.rightAutomationLanes[0]!.points[0]!;
        expect(seam.id).toBe('asp-split-c2-0');
        expect(seam.beat).toBe(4);
        expect(seam.curve).toBe('bezier');
        expect(seam.value).toBeCloseTo(subdivision.yAtCut, 12);
        expect(seam.cp1).toEqual(subdivision.cp1);
        expect(seam.cp2).toEqual(subdivision.cp2);

        // RIGHT fragment: at every absolute beat at or after the cut it plays
        // exactly what the source played before the split — the continued
        // curve, then the held end value past beat 7.
        restoreAutomationSnapshot({ lanes: [plan.rightAutomationLanes[0]!] });
        expectSweepMatches(sweepLane('auto-split-c2-0'), beforeSplit);
    });

    it('derives exact seam cps from the default quad when no cps were authored', () => {
        const sourcePoints: SeamSpecPoint[] = [
            { beat: 1, value: 0.2, curve: 'bezier' },
            { beat: 7, value: 0.8, curve: 'bezier' },
        ];
        restoreAutomationSnapshot({ lanes: [clipLane({ id: 'lane-1', points: sourcePoints })] });
        const beforeSplit = sweepLane('lane-1');

        const plan = planFor(4);

        // The defaults path subdivides too: the seam cps are the right half of
        // the DEFAULT quad the source played, not absent cps.
        const quad = resolveBezierControls({ firstPoint: sourcePoints[0]!, secondPoint: sourcePoints[1]! });
        expect(quad).toEqual({ cx1: 0.33, cx2: 0.66, cy1: 0.2, cy2: 0.8 });
        const subdivision = subdivideBezierRightHalf({ ...quad, y0: 0.2, y3: 0.8, cutFraction: 0.5 });
        const seam = plan.rightAutomationLanes[0]!.points[0]!;
        expect(seam.cp1).toEqual(subdivision.cp1);
        expect(seam.cp2).toEqual(subdivision.cp2);

        const leftFragment = sweepLane('lane-1');
        expect(leftFragment).toEqual(beforeSplit);
        restoreAutomationSnapshot({ lanes: [plan.rightAutomationLanes[0]!] });
        expectSweepMatches(sweepLane('auto-split-c2-0'), beforeSplit);
    });

    it('mints no seam when an authored point sits on the cut, keeping its cps', () => {
        const pointOnCut: SeamSpecPoint = { beat: 4, value: 0.55, curve: 'bezier', cp1: { x: 0.4, y: 0.6 } };
        restoreAutomationSnapshot({
            lanes: [
                clipLane({
                    id: 'lane-1',
                    points: [
                        { beat: 1, value: 0.2, curve: 'bezier', ...AUTHORED_CPS },
                        pointOnCut,
                        { beat: 7, value: 0.8, curve: 'bezier' },
                    ],
                }),
            ],
        });
        const beforeSplit = sweepLane('lane-1');

        const plan = planFor(4);

        // The authored point IS the seam; its own cps own the 4→7 segment.
        const copy = plan.rightAutomationLanes[0]!;
        expect(copy.points.map((point) => point.beat)).toEqual([4, 7]);
        expect(copy.points[0]!.cp1).toEqual(pointOnCut.cp1);

        restoreAutomationSnapshot({ lanes: [copy] });
        expectSweepMatches(sweepLane('auto-split-c2-0'), beforeSplit);
    });

    it.each(['linear', 'step', 's-curve', 'smooth'] as const)(
        'carries no cps on a %s seam — byte-identical to the pre-#4044 shape',
        (curve) => {
            const tension = curve === 's-curve' ? 0.5 : 0;
            restoreAutomationSnapshot({
                lanes: [
                    clipLane({
                        id: 'lane-1',
                        points: [
                            { beat: 1, value: 0.2, curve, tension },
                            { beat: 7, value: 0.8, curve, tension },
                        ],
                    }),
                ],
            });
            const seamValue = getAutomationValueAtBeat('lane-1', 4);
            expect(seamValue).not.toBeNull();

            const plan = planFor(4);

            // Those point models have no cp fields; minting cps for them would
            // be dead data — and the seam shape itself must not change.
            const seam = plan.rightAutomationLanes[0]!.points[0]!;
            expect('cp1' in seam).toBe(false);
            expect('cp2' in seam).toBe(false);
            expect(seam).toEqual({
                id: 'asp-split-c2-0',
                beat: 4,
                value: seamValue,
                curve,
                tension,
            });
        }
    );

    it('reproduces the seam identically across two invocations on identical state', () => {
        // Redo re-splits must land the same deterministic ids AND cps: the
        // subdivision is a pure function of the source segment and the cut.
        const seed = () =>
            restoreAutomationSnapshot({
                lanes: [
                    clipLane({
                        id: 'lane-1',
                        points: [
                            { beat: 1, value: 0.2, curve: 'bezier', ...AUTHORED_CPS },
                            { beat: 7, value: 0.8, curve: 'bezier' },
                        ],
                    }),
                ],
            });

        seed();
        const firstPlan = planFor(4);
        seed();
        const secondPlan = planFor(4);

        expect(secondPlan.rightAutomationLanes).toEqual(firstPlan.rightAutomationLanes);
        expect(secondPlan.next).toEqual(firstPlan.next);
    });
});
