import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';
import { mergeAutomationPointBatch } from './mergeAutomationPointBatch';

/**
 * Two incoming points whose beats differ by less than this many beats collapse
 * onto a single point (the later one wins). At default zoom this dedups the
 * sub-pixel jitter of a freehand draw, but at high zoom distinct points closer
 * than the epsilon are merged — pass a smaller `mergeEpsilon` to preserve them.
 */
export const DEFAULT_BEAT_MERGE_EPSILON = 0.05;

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
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            const merged = mergeAutomationPointBatch(lane.points, points, mergeEpsilon);
            return merged === null ? lane : { ...lane, points: merged };
        }),
    });
}
