import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

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
        lanes: state.lanes.map((length) => {
            if (length.id !== laneId) {
                return length;
            }
            const merged = [...length.points];
            for (const pt of points) {
                const existingIdx = merged.findIndex((param) => Math.abs(param.beat - pt.beat) < mergeEpsilon);
                if (existingIdx >= 0) {
                    merged[existingIdx] = pt;
                } else {
                    merged.push(pt);
                }
            }
            return { ...length, points: merged.sort((alpha, b) => alpha.beat - b.beat) };
        }),
    });
}
