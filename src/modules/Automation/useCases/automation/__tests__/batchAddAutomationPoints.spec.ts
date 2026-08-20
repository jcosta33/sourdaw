import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AutomationLane, type AutomationPoint } from '../../../models/Automation';
import { batchAddAutomationPoints, DEFAULT_BEAT_MERGE_EPSILON } from '../batchAddAutomationPoints';

const storeCell = vi.hoisted(() => ({
    state: null as { lanes: AutomationLane[] } | null,
}));

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return storeCell.state;
        },
        set(next: { lanes: AutomationLane[] }) {
            storeCell.state = next;
        },
    },
}));

function makeLane(id: string, points: AutomationPoint[]): AutomationLane {
    return {
        id,
        trackId: 't1',
        parameterId: 'gain',
        parameterName: 'Gain',
        points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function point(beat: number, value = 0): AutomationPoint {
    return { beat, value, curve: 'linear', tension: 0 };
}

/**
 * The original O(n·m) implementation, kept verbatim as a reference oracle.
 * Every merge test below asserts the fast (binary-search) implementation
 * produces the identical point set for the same input — the cheapest way to
 * be sure a "faster" merge did not quietly become a "different" merge.
 */
function referenceMerge(
    existingPoints: readonly AutomationPoint[],
    incoming: readonly AutomationPoint[],
    mergeEpsilon: number
): AutomationPoint[] {
    const merged = [...existingPoints];
    for (const pt of incoming) {
        const existingIdx = merged.findIndex((param) => Math.abs(param.beat - pt.beat) < mergeEpsilon);
        if (existingIdx >= 0) {
            merged[existingIdx] = pt;
        } else {
            merged.push(pt);
        }
    }
    return merged.sort((alpha, b) => alpha.beat - b.beat);
}

function runNewMerge(
    existingPoints: readonly AutomationPoint[],
    incoming: readonly AutomationPoint[],
    mergeEpsilon: number
): AutomationPoint[] {
    storeCell.state = { lanes: [makeLane('lane-under-test', [...existingPoints])] };
    batchAddAutomationPoints('lane-under-test', [...incoming], mergeEpsilon);
    return storeCell.state.lanes[0]!.points;
}

/** Fails if any two adjacent (sorted) output points are closer than `mergeEpsilon` apart. */
function assertNoNearDuplicateBeats(resultPoints: readonly AutomationPoint[], mergeEpsilon: number): void {
    for (let index = 1; index < resultPoints.length; index += 1) {
        const gap = resultPoints[index]!.beat - resultPoints[index - 1]!.beat;
        expect(gap).toBeGreaterThanOrEqual(mergeEpsilon);
    }
}

/**
 * Wraps each point so every read of `.beat` increments a counter — used to
 * assert the merge's search cost stays bounded without relying on
 * wall-clock timing, which is flaky under this repo's two-worker test
 * concurrency and varies with machine load independently of whether the
 * algorithm regressed.
 */
function countBeatReads(points: readonly AutomationPoint[]): {
    proxied: AutomationPoint[];
    getReadCount: () => number;
} {
    let reads = 0;
    const proxied = points.map(
        (original) =>
            new Proxy(original, {
                get(target, property, receiver) {
                    if (property === 'beat') {
                        reads += 1;
                    }
                    return Reflect.get(target, property, receiver);
                },
            })
    );
    return { proxied, getReadCount: () => reads };
}

describe('batchAddAutomationPoints', () => {
    beforeEach(() => {
        storeCell.state = {
            lanes: [
                makeLane('lane-a', [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }]),
                makeLane('lane-b', [{ beat: 10, value: 1, curve: 'linear', tension: 0 }]),
            ],
        };
    });

    it('does nothing when automation store has no snapshot', () => {
        storeCell.state = null;

        batchAddAutomationPoints('lane-a', [{ beat: 2, value: 0.25, curve: 'linear', tension: 0 }]);

        expect(storeCell.state).toBeNull();
    });

    it('merges new points into the target lane and leaves other lanes unchanged', () => {
        batchAddAutomationPoints('lane-a', [
            { beat: 4, value: 0.25, curve: 'linear', tension: 0 },
            { beat: 2, value: 0.75, curve: 'linear', tension: 0 },
        ]);

        const laneA = storeCell.state!.lanes.find((length) => length.id === 'lane-a');
        const laneB = storeCell.state!.lanes.find((length) => length.id === 'lane-b');

        expect(laneA?.points.map((param) => param.beat)).toEqual([1, 2, 4]);
        expect(laneB?.points).toEqual([{ beat: 10, value: 1, curve: 'linear', tension: 0 }]);
    });

    it('replaces an existing point when the new point is within 0.05 beats', () => {
        batchAddAutomationPoints('lane-a', [{ beat: 1.02, value: 0.9, curve: 'linear', tension: 0 }]);

        const laneA = storeCell.state!.lanes.find((length) => length.id === 'lane-a');
        expect(laneA?.points).toHaveLength(1);
        expect(laneA?.points[0]).toMatchObject({ beat: 1.02, value: 0.9 });
    });

    describe('behavioural parity with the O(n·m) reference merge', () => {
        it('agrees on an empty lane', () => {
            const existing: AutomationPoint[] = [];
            const incoming = [point(1), point(2), point(1.5)];

            expect(runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON)).toEqual(
                referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON)
            );
        });

        it('does not match a point sitting exactly on the epsilon boundary', () => {
            // The match test is strict `<`, so a point exactly `mergeEpsilon`
            // away must NOT collapse into the existing point.
            const existing = [point(1)];
            const incoming = [point(1 + DEFAULT_BEAT_MERGE_EPSILON)];

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(expected).toHaveLength(2);
            expect(runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON)).toEqual(expected);
        });

        it('matches a point just inside the epsilon boundary', () => {
            const existing = [point(1)];
            const incoming = [point(1 + DEFAULT_BEAT_MERGE_EPSILON - 0.001)];

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(expected).toHaveLength(1);
            expect(runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON)).toEqual(expected);
        });

        it('picks the lowest-beat existing point when several fall inside one window', () => {
            // Three existing points all mutually within one epsilon window of
            // the incoming point (and of each other). The reference merge's
            // `findIndex` returns the first match in (sorted) array order —
            // i.e. the lowest beat. The binary-search replacement must find
            // the same leftmost match.
            const existing = [point(1.0, 0.1), point(1.02, 0.2), point(1.04, 0.3)];
            const incoming = [point(1.03, 0.9)];

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(expected.map((p) => p.beat)).toEqual([1.02, 1.03, 1.04]);
            expect(runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON)).toEqual(expected);
        });

        it('collapses incoming points that collide with each other (later wins), per no existing match', () => {
            const existing: AutomationPoint[] = [];
            const incoming = [point(5.0, 0.1), point(5.01, 0.2)];

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(expected).toEqual([{ beat: 5.01, value: 0.2, curve: 'linear', tension: 0 }]);
            expect(runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON)).toEqual(expected);
        });

        it('lets a later incoming point collide with one an earlier incoming point just pushed', () => {
            // Neither incoming point matches anything already in the lane;
            // the second must still be able to match (and overwrite) the
            // first once it has been added to this batch's working set.
            const existing = [point(0)];
            const incoming = [point(9.0, 0.1), point(9.02, 0.2), point(9.03, 0.3)];

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(expected.map((p) => p.beat)).toEqual([0, 9.03]);
            expect(runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON)).toEqual(expected);
        });

        it('leaves lane order and untouched points intact for a mixed batch', () => {
            const existing = [point(0), point(1), point(2), point(3), point(10)];
            const incoming = [point(1.01, 0.5), point(6), point(2.5)];

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON)).toEqual(expected);
        });

        it('cross-checks a randomized batch of tightly-clustered points', () => {
            // Deterministic PRNG so the case is reproducible. Clusters are
            // spaced 10 beats apart (far past any epsilon window) so
            // different clusters never interact, while points inside one
            // cluster are close enough to collide with each other and with
            // that cluster's existing point, if any.
            let seed = 42;
            function rand(): number {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                return seed / 0x7fffffff;
            }

            const existing: AutomationPoint[] = [];
            const incoming: AutomationPoint[] = [];
            for (let cluster = 0; cluster < 200; cluster += 1) {
                const base = cluster * 10;
                if (rand() < 0.7) {
                    existing.push(point(base + rand() * DEFAULT_BEAT_MERGE_EPSILON * 0.9, rand()));
                }
                let incomingCount = 0;
                if (rand() >= 0.5) {
                    incomingCount = rand() < 0.5 ? 1 : 2;
                }
                for (let index = 0; index < incomingCount; index += 1) {
                    incoming.push(point(base + rand() * DEFAULT_BEAT_MERGE_EPSILON * 0.9, rand()));
                }
            }

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON)).toEqual(expected);
        });
    });

    describe('chained epsilon collisions', () => {
        it('collapses an ascending drift chain onto the existing point, exactly like the reference', () => {
            // The old O(n·m) scan never re-sorts mid-batch, so a slot's
            // CURRENT (already-overwritten) value — not its original beat —
            // is what a later incoming point was tested against: point A
            // matches the existing point directly and claims its slot;
            // point B is within mergeEpsilon of A's beat but NOT of the
            // existing point's ORIGINAL beat. A fix that only binary-
            // searches the immutable original array misses that B should
            // still collapse onto A's slot, and ends up emitting a
            // near-duplicate pair inside the very window mergeEpsilon
            // exists to prevent. This must chain exactly like the
            // reference: one output point, not two.
            const existing = [point(10.0, 0.1)];
            const incoming = [point(10.03, 0.2), point(10.06, 0.3)];

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(expected.map((p) => p.beat)).toEqual([10.06]);

            const actual = runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(actual).toEqual(expected);
            assertNoNearDuplicateBeats(actual, DEFAULT_BEAT_MERGE_EPSILON);
        });

        it('collapses a longer ascending drift chain the same way', () => {
            const existing = [point(10.0, 0.1)];
            const incoming = [point(10.03, 0.2), point(10.06, 0.3), point(10.09, 0.4), point(10.12, 0.5)];

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(expected.map((p) => p.beat)).toEqual([10.12]);

            const actual = runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(actual).toEqual(expected);
            assertNoNearDuplicateBeats(actual, DEFAULT_BEAT_MERGE_EPSILON);
        });

        it('collapses a tight cluster fed in descending beat order', () => {
            // Every point here is within mergeEpsilon of every other point,
            // including the existing one, so any processing order must
            // still collapse to a single output point.
            const existing = [point(10.0, 0.1)];
            const incoming = [point(10.03, 0.4), point(10.02, 0.3), point(10.01, 0.2)];

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(expected).toHaveLength(1);

            const actual = runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(actual).toEqual(expected);
            assertNoNearDuplicateBeats(actual, DEFAULT_BEAT_MERGE_EPSILON);
        });

        it('collapses a drift chain interleaved with an unrelated point', () => {
            const existing = [point(10.0, 0.1), point(50.0, 0.9)];
            const incoming = [point(10.03, 0.2), point(50.0, 0.95), point(10.06, 0.3)];

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(expected.map((p) => p.beat)).toEqual([10.06, 50.0]);

            const actual = runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(actual).toEqual(expected);
            assertNoNearDuplicateBeats(actual, DEFAULT_BEAT_MERGE_EPSILON);
        });

        it('matches the reference exactly even when an ordering does not fully collapse the chain', () => {
            // The reference's "first match by array order" rule is not a
            // global, order-independent dedup: the first incoming point
            // here misses the existing point outright and is pushed as a
            // new point; the second then matches the still-unclaimed
            // existing point directly rather than the first incoming point,
            // so the reference itself does not collapse this particular
            // ordering to one point. This asserts exact parity with that
            // behaviour — a stronger, more honest guarantee than asserting
            // a "no near duplicates" invariant the reference never made.
            const existing = [point(10.0, 0.1)];
            const incoming = [point(10.06, 0.2), point(10.03, 0.3)];

            const expected = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            expect(expected.map((p) => p.beat)).toEqual([10.03, 10.06]);

            expect(runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON)).toEqual(expected);
        });
    });

    describe('performance at recording-flush scale', () => {
        function buildFlushScaleInput(
            existingCount: number,
            incomingCount: number
        ): {
            existing: AutomationPoint[];
            incoming: AutomationPoint[];
        } {
            const existing: AutomationPoint[] = [];
            for (let index = 0; index < existingCount; index += 1) {
                // 0.2-beat spacing keeps existing points well outside each
                // other's epsilon window, matching a real lane built up over
                // a long take rather than an artificially dense one.
                existing.push(point(index * 0.2, (index % 100) / 100));
            }
            const incoming: AutomationPoint[] = [];
            const tailStart = existingCount * 0.2;
            for (let index = 0; index < incomingCount; index += 1) {
                // Continues the take: a realistic RDP-thinned flush appends
                // past the end of what is already recorded, rather than
                // rescanning the middle of the lane.
                incoming.push(point(tailStart + index * 0.2, (index % 100) / 100));
            }
            return { existing, incoming };
        }

        it('merges a realistic flush against a lane holding tens of thousands of points identically to the reference', () => {
            const { existing, incoming } = buildFlushScaleInput(30_000, 1_000);

            // Wall-clock numbers are measurement evidence only — this test
            // does not gate on them. Vitest runs this repo's specs with two
            // workers, so timing a `performance.now()` race against the
            // reference on a loaded or contended machine would fail (or
            // pass) independent of whether the algorithm actually
            // regressed. The deterministic regression guard is the
            // read-count test below.
            const before = performance.now();
            const oldResult = referenceMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            const oldDurationMs = performance.now() - before;

            const after = performance.now();
            const newResult = runNewMerge(existing, incoming, DEFAULT_BEAT_MERGE_EPSILON);
            const newDurationMs = performance.now() - after;

            // eslint-disable-next-line no-console
            console.info(
                `[batchAddAutomationPoints perf] n=${existing.length} m=${incoming.length} ` +
                    `old=${oldDurationMs.toFixed(2)}ms new=${newDurationMs.toFixed(2)}ms`
            );

            expect(newResult).toEqual(oldResult);
        });

        it('does not regress from a bounded dedup scan back toward a linear scan of every existing point', () => {
            const existingCount = 30_000;
            const incomingCount = 1_000;
            const { existing, incoming } = buildFlushScaleInput(existingCount, incomingCount);

            const { proxied, getReadCount } = countBeatReads(existing);
            storeCell.state = { lanes: [makeLane('lane-under-test', proxied)] };
            batchAddAutomationPoints('lane-under-test', incoming, DEFAULT_BEAT_MERGE_EPSILON);

            const reads = getReadCount();
            // A correct merge reads each existing point's `.beat` a bounded
            // number of times: O(log n) per incoming point during the
            // binary search, plus O(n) once during the final sort (already
            // near-sorted, so V8's adaptive sort stays close to linear
            // here). For n=30,000 and m=1,000 that lands in the tens of
            // thousands of reads. A regression back to the old per-point
            // linear scan reads roughly n*m times — on the order of tens of
            // millions here. This bound sits comfortably between the two,
            // so it fails deterministically if the scan regresses,
            // independent of wall-clock speed or machine load.
            expect(reads).toBeLessThan(500_000);
        });
    });
});
