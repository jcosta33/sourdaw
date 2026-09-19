import { evaluateAutomationLaneAtBeat } from '#/utils/evaluateAutomationLaneAtBeat';

import { automationStore } from '../../stores/automationStore';

import { getAutomationLaneCeiling } from './getAutomationLaneCeiling';

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
    return evaluateAutomationLaneAtBeat({
        laneId,
        beat,
        getLane: (id) => _laneByIdCache.get(id),
        resolveLaneCeiling: getAutomationLaneCeiling,
        resolveLaneDeclaredMax: (lane) => lane.maxValue,
        visited: _visited,
    });
}
