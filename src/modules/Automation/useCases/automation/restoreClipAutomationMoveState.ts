import { type ClipAutomationLaneActionSnapshot } from '#/utils/handlerContract';

import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function restoreClipAutomationMoveState(
    clipId: string,
    replacement: readonly ClipAutomationLaneActionSnapshot[]
): boolean {
    const state = automationStore.value;
    if (!state) {
        return replacement.length === 0;
    }
    const replacementsById = new Map(replacement.map((lane) => [lane.id, lane]));
    if (replacementsById.size !== replacement.length) {
        return false;
    }
    const matchingLaneIds = new Set(state.lanes.filter((lane) => lane.clipId === clipId).map((lane) => lane.id));
    if (matchingLaneIds.size !== replacementsById.size) {
        return false;
    }
    for (const replacementLaneId of replacementsById.keys()) {
        if (!matchingLaneIds.has(replacementLaneId)) {
            return false;
        }
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            const replacementLane = replacementsById.get(lane.id);
            if (!replacementLane) {
                return lane;
            }
            return {
                ...lane,
                trackId: replacementLane.trackId,
                points: replacementLane.points.map((point) => ({
                    ...point,
                    ...(point.cp1 ? { cp1: { ...point.cp1 } } : {}),
                    ...(point.cp2 ? { cp2: { ...point.cp2 } } : {}),
                })) as AutomationPoint[],
            };
        }),
    });
    return true;
}
