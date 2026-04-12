import { automationStore } from '../../stores/automationStore';
import { interpolateAutomationValue } from '#/modules/Arrangement/useCases';

export function getAutomationValueAtBeat(laneId: string, beat: number): number | null {
    const state = automationStore.value;
    if (!state) {
        return null;
    }

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane || lane.points.length === 0) {
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

    return interpolateAutomationValue(points[beforeIdx]!, points[beforeIdx + 1]!, beat);
}
