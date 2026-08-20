import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

/**
 * Two incoming points whose beats differ by less than this many beats collapse
 * onto a single point (the later one wins). At default zoom this dedups the
 * sub-pixel jitter of a freehand draw, but at high zoom distinct points closer
 * than the epsilon are merged — pass a smaller `mergeEpsilon` to preserve them.
 */
export const DEFAULT_BEAT_MERGE_EPSILON = 0.05;

/**
 * Leftmost UNCLAIMED index in `sorted` whose ORIGINAL beat falls in the open
 * window `(beat - mergeEpsilon, beat + mergeEpsilon)`, or -1 if none does.
 * "Unclaimed" skips any index an earlier incoming point in this batch has
 * already overwritten — those are matched separately, against their CURRENT
 * value, by `findClaimedMatchIndex`, since their beat may have drifted away
 * from (or into) this window.
 *
 * `sorted` must be ascending by beat. That invariant is guaranteed at the
 * store's inbound boundary — `get_normalized_points` in `automationStore.ts`
 * sorts `points` (and `trimPoints`/`ghostPoints`) on every sanitize, which
 * `hydrate()` re-runs on every load and every remote CRDT sync patch, not
 * just initial project load — so a lane read from the store is never
 * unsorted here, regardless of what order the writing peer's array was in.
 * `addAutomationPoint.ts` relies on the same guarantee for its own
 * binary-search insert. This function never re-sorts on entry.
 */
function findLeftmostUnclaimedIndex(
    sorted: readonly AutomationPoint[],
    claims: ReadonlyMap<number, AutomationPoint>,
    beat: number,
    mergeEpsilon: number
): number {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sorted[mid]!.beat <= beat - mergeEpsilon) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    let index = lo;
    while (index < sorted.length && sorted[index]!.beat < beat + mergeEpsilon) {
        if (!claims.has(index)) {
            return index;
        }
        index += 1;
    }
    return -1;
}

/**
 * Lowest original-array index among slots an earlier incoming point in this
 * batch has already claimed whose CURRENT (overwritten) value matches `beat`.
 *
 * `claims` is bounded by the incoming batch size, not by the lane's point
 * count, so this linear scan does not reintroduce the O(n) cost the binary
 * search above replaces — it is the same complexity trade the `pending` scan
 * below already makes for incoming-vs-incoming collisions.
 */
function findClaimedMatchIndex(
    claims: ReadonlyMap<number, AutomationPoint>,
    beat: number,
    mergeEpsilon: number
): number {
    let best = -1;
    for (const [index, claimedPoint] of claims) {
        if (Math.abs(claimedPoint.beat - beat) >= mergeEpsilon) {
            continue;
        }
        if (best === -1 || index < best) {
            best = index;
        }
    }
    return best;
}

export function batchAddAutomationPoints(
    laneId: string,
    points: AutomationPoint[],
    mergeEpsilon: number = DEFAULT_BEAT_MERGE_EPSILON
): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((length) => {
            if (length.id !== laneId) {
                return length;
            }
            const existing = length.points;

            // Two small pools track this batch's own effect on the merge,
            // each bounded by the incoming batch size rather than by the
            // lane's point count:
            //  - `claims`: existing-array slots an incoming point has
            //    already overwritten, keyed by their ORIGINAL index so a
            //    later point matching that slot keeps the same priority
            //    relative to every other existing point that the old scan's
            //    lowest-index-first `findIndex` gave it once `existing` was
            //    sorted.
            //  - `pending`: incoming points that matched neither the
            //    existing set nor a claim.
            // A later incoming point can collide with EITHER pool: a claimed
            // slot (a chain of near-identical incoming points must still
            // collapse onto one output point, even though each one only
            // matches its immediate neighbour and not the original existing
            // beat) or a pending point. Without matching against `claims`,
            // an epsilon-chain of incoming points could each dodge the
            // ORIGINAL existing beat by a hair while staying within
            // `mergeEpsilon` of each other, and the merge would emit a
            // near-duplicate pair — exactly what `mergeEpsilon` exists to
            // prevent.
            const claims = new Map<number, AutomationPoint>();
            const pending: AutomationPoint[] = [];

            for (const point of points) {
                const claimedIndex = findClaimedMatchIndex(claims, point.beat, mergeEpsilon);
                const unclaimedIndex = findLeftmostUnclaimedIndex(existing, claims, point.beat, mergeEpsilon);

                let targetIndex: number;
                if (claimedIndex !== -1 && unclaimedIndex !== -1) {
                    targetIndex = Math.min(claimedIndex, unclaimedIndex);
                } else if (claimedIndex !== -1) {
                    targetIndex = claimedIndex;
                } else {
                    targetIndex = unclaimedIndex;
                }

                if (targetIndex !== -1) {
                    claims.set(targetIndex, point);
                    continue;
                }

                const pendingIndex = pending.findIndex((pt) => Math.abs(pt.beat - point.beat) < mergeEpsilon);
                if (pendingIndex >= 0) {
                    pending[pendingIndex] = point;
                } else {
                    pending.push(point);
                }
            }

            if (claims.size === 0 && pending.length === 0) {
                return length;
            }

            const merged = existing.map((point, index) => claims.get(index) ?? point);
            merged.push(...pending);
            merged.sort((alpha, b) => alpha.beat - b.beat);
            return { ...length, points: merged };
        }),
    });
}
