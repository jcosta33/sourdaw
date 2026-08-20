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
 * Wraps every point of every array passed in so every read of `.beat`
 * anywhere increments one shared counter — used to assert the merge's
 * search cost stays bounded without relying on wall-clock timing, which is
 * flaky under this repo's two-worker test concurrency and varies with
 * machine load independently of whether the algorithm regressed.
 *
 * Takes multiple arrays (rather than one) because the merge's cost is not
 * confined to reads of `existing`: `findClaimedMatchIndex` reads `.beat` off
 * `claims`' values and the `pending` scan reads it off `pending`'s entries,
 * and both pools are populated from `incoming`, not `existing`. Wrapping
 * only `existing` would leave those two loops free to regress without this
 * counter ever moving.
 */
function countBeatReads(...pointArrays: ReadonlyArray<readonly AutomationPoint[]>): {
    proxiedArrays: AutomationPoint[][];
    getReadCount: () => number;
} {
    let reads = 0;
    const proxiedArrays = pointArrays.map((points) =>
        points.map(
            (original) =>
                new Proxy(original, {
                    get(target, property, receiver) {
                        if (property === 'beat') {
                            reads += 1;
                        }
                        return Reflect.get(target, property, receiver);
                    },
                })
        )
    );
    return { proxiedArrays, getReadCount: () => reads };
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

            const { proxiedArrays, getReadCount } = countBeatReads(existing, incoming);
            const [proxiedExisting, proxiedIncoming] = proxiedArrays as [AutomationPoint[], AutomationPoint[]];
            storeCell.state = { lanes: [makeLane('lane-under-test', proxiedExisting)] };
            batchAddAutomationPoints('lane-under-test', proxiedIncoming, DEFAULT_BEAT_MERGE_EPSILON);

            const reads = getReadCount();
            // Both `existing` and `incoming` are wrapped, so this counts
            // every `.beat` read the merge makes, not just the binary
            // search's. A correct run reads: O(log n) per incoming point for
            // `findLeftmostUnclaimedIndex`'s binary search over `existing`;
            // O(pending.length) per incoming point for the `pending` scan —
            // this scenario's incoming points never match `existing` and
            // never collide with each other (see `buildFlushScaleInput`), so
            // every point falls through to `pending` and never finds a
            // match there either, making that scan's own cost O(m^2) (m is
            // the incoming batch size, bounded independent of the lane) —
            // and finally one O((n+m) log(n+m)) sort over the merged array.
            // Measured on this machine that lands at ~1.08M reads for
            // n=30,000, m=1,000. A regression back to the old per-point
            // linear scan of `existing` reads roughly n*m times — on the
            // order of tens of millions here. This bound sits with headroom
            // above the measured correct-run count and far below that
            // regression floor, so it fails deterministically if the scan
            // regresses, independent of wall-clock speed or machine load.
            //
            // This scenario's `claims` map stays empty throughout — see
            // `does not regress the claim/pending merge paths back toward a
            // lane-sized scan` below for the scenario that actually
            // populates `claims` and exercises `findClaimedMatchIndex`.
            expect(reads).toBeLessThan(2_000_000);
        });

        function buildReRecordScaleInput(
            existingCount: number,
            incomingCount: number
        ): {
            existing: AutomationPoint[];
            incoming: AutomationPoint[];
        } {
            const existing: AutomationPoint[] = [];
            for (let index = 0; index < existingCount; index += 1) {
                existing.push(point(index * 0.2, (index % 100) / 100));
            }

            const incoming: AutomationPoint[] = [];
            // A re-record pass, unlike an append-only flush, overwrites what
            // is already there: ~90% of incoming points sit within
            // `mergeEpsilon` of the existing point at the same index, so
            // they claim that slot. This is what actually drives
            // `findClaimedMatchIndex` and the `claims` map at batch scale —
            // `buildFlushScaleInput`'s append-only tail never touches an
            // existing point at all, so `claims` stays empty there.
            const overwriteCount = Math.floor(incomingCount * 0.9);
            for (let index = 0; index < overwriteCount; index += 1) {
                const offset = (index % 2 === 0 ? 1 : -1) * DEFAULT_BEAT_MERGE_EPSILON * 0.4;
                incoming.push(point(index * 0.2 + offset, ((index + 1) % 100) / 100));
            }

            // The rest lands in a fresh region past the recorded lane, each
            // point within `mergeEpsilon` of the last, so consecutive
            // incoming points collide with EACH OTHER instead of with
            // `existing` — this is what drives the `pending` linear scan and
            // the claimed-slot chain in `findClaimedMatchIndex` beyond a
            // single match per point.
            const chainStart = existingCount * 0.2 + 100;
            for (let index = overwriteCount; index < incomingCount; index += 1) {
                const step = (index - overwriteCount) * DEFAULT_BEAT_MERGE_EPSILON * 0.5;
                incoming.push(point(chainStart + step, ((index + 2) % 100) / 100));
            }

            return { existing, incoming };
        }

        it('does not regress the claim/pending merge paths back toward a lane-sized scan', () => {
            const existingCount = 30_000;
            const incomingCount = 1_000;
            const { existing, incoming } = buildReRecordScaleInput(existingCount, incomingCount);

            const { proxiedArrays, getReadCount } = countBeatReads(existing, incoming);
            const [proxiedExisting, proxiedIncoming] = proxiedArrays as [AutomationPoint[], AutomationPoint[]];
            storeCell.state = { lanes: [makeLane('lane-under-test', proxiedExisting)] };
            batchAddAutomationPoints('lane-under-test', proxiedIncoming, DEFAULT_BEAT_MERGE_EPSILON);

            const reads = getReadCount();
            // eslint-disable-next-line no-console
            console.info(`[batchAddAutomationPoints perf] claim/pending re-record reads=${reads}`);

            // Measured on this machine at n=30,000, m=1,000, ~900 claims:
            // 572,467 reads (see the console line above; re-run to see this
            // machine's own figure — it moves with V8 sort internals and
            // isn't pinned bit-for-bit). Every read here is bounded by `m`,
            // not `n`: the binary search is O(log n) per point,
            // `findClaimedMatchIndex` is O(claims.size) <= O(m) per point,
            // and the `pending` scan is O(pending.length) <= O(m) per point,
            // so the whole batch is O(m log n + m^2) — independent of `n`
            // apart from the log factor. A regression that made either the
            // claims check or the pending scan touch something proportional
            // to the LANE instead of the bounded batch (e.g. rescanning
            // `existing` per incoming point, the exact shape the binary
            // search above replaced) multiplies this by roughly n/m ≈ 30,
            // landing in the tens of millions. 2,000,000 sits with headroom
            // above the measured correct-run count and far below that.
            expect(reads).toBeLessThan(2_000_000);
        });
    });
});
