import { resolveLinkedLane } from '#/utils/automationLaneLink';

import { interpolateAutomationPointValue } from '../../services/automationPointAlgorithms';
import { automationStore } from '../../stores/automationStore';

type AutomationLane = NonNullable<typeof automationStore.value>['lanes'][number];

/**
 * Lane-by-id index cache. Rebuilt only when the underlying `lanes` array
 * reference changes — otherwise the per-tick scheduler call reuses the map.
 * Avoids the O(lanes) `state.lanes.find()` scan on every tick per lane
 * (see audit §158.1 follow-up note).
 */
let _lastLanesRef: readonly AutomationLane[] | null = null;
const _laneByIdCache = new Map<string, AutomationLane>();

export function getAutomationValueAtBeat(
    laneId: string,
    beat: number,
    _visited: Set<string> = new Set()
): number | null {
    const state = automationStore.value;
    if (!state) {
        return null;
    }

    if (state.lanes !== _lastLanesRef) {
        _lastLanesRef = state.lanes;
        _laneByIdCache.clear();
        for (const candidate of state.lanes) {
            _laneByIdCache.set(candidate.id, candidate);
        }
    }
    // R-F3.3: resolve any linked-lane chain (cycle-guarded, linkScale
    // accumulated) to the authoritative point holder. A linked lane *is* its
    // source — it never falls through to its own points — so this replaces the
    // former inline recursion and shares the resolver with the offline render
    // path (finding AU-3). `_visited` is reused to avoid a per-tick allocation.
    const resolved = resolveLinkedLane(laneId, (id) => _laneByIdCache.get(id), _visited);
    if (!resolved) {
        return null;
    }

    const lane = _laneByIdCache.get(resolved.sourceLaneId);
    if (!lane) {
        return null;
    }

    if (lane.points.length === 0) {
        return null;
    }

    const points = lane.points;

    // Points are kept sorted by beat. Use binary search to find the last point
    // with beat <= target — avoids two O(n) filter() allocations per tick.
    let lo = 0;
    let hi = points.length - 1;
    let beforeIdx = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (points[mid]!.beat <= beat) {
            beforeIdx = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    if (beforeIdx === -1) {
        return points[0]!.value * resolved.scale;
    }
    if (beforeIdx === points.length - 1) {
        return points[beforeIdx]!.value * resolved.scale;
    }

    // Pass the surrounding points so a 'smooth' (Catmull-Rom) segment uses its
    // true interior neighbors; without them every interior segment collapses to
    // a 2-point Hermite that ignores curvature. `previousPoint`/`nextPoint` are
    // optional — undefined at the ends, where the spline already degrades to the
    // endpoint tangents by design.
    const interpolated = interpolateAutomationPointValue({
        firstPoint: points[beforeIdx]!,
        secondPoint: points[beforeIdx + 1]!,
        beat,
        previousPoint: points[beforeIdx - 1],
        nextPoint: points[beforeIdx + 2],
    });
    return interpolated * resolved.scale;
}
