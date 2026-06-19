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
    const lane = _laneByIdCache.get(laneId);
    if (!lane) {
        return null;
    }

    // R-F3.3: Follow linked lane if set. A linked lane *is* its source — it does
    // not consult its own points, so the linked source is authoritative even
    // when the source is empty: an empty source yields null (no value to report),
    // never a silent fall-through to this lane's local points.
    if (lane.linkedLaneId) {
        // Guard against circular links (A→B→A) — break the cycle.
        if (_visited.has(lane.linkedLaneId)) {
            return 0;
        }
        _visited.add(laneId);
        const sourceVal = getAutomationValueAtBeat(lane.linkedLaneId, beat, _visited);
        if (sourceVal === null) {
            return null;
        }
        const scale = lane.linkScale ?? 1;
        return sourceVal * scale;
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
        return points[0]!.value;
    }
    if (beforeIdx === points.length - 1) {
        return points[beforeIdx]!.value;
    }

    // Pass the surrounding points so a 'smooth' (Catmull-Rom) segment uses its
    // true interior neighbors; without them every interior segment collapses to
    // a 2-point Hermite that ignores curvature. `previousPoint`/`nextPoint` are
    // optional — undefined at the ends, where the spline already degrades to the
    // endpoint tangents by design.
    return interpolateAutomationPointValue({
        firstPoint: points[beforeIdx]!,
        secondPoint: points[beforeIdx + 1]!,
        beat,
        previousPoint: points[beforeIdx - 1],
        nextPoint: points[beforeIdx + 2],
    });
}
