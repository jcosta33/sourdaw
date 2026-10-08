import { getAutomationLanes } from '#/modules/Automation/useCases';

import { type AutomationLaneValue } from './readClipScopedAutomationLanes';

/**
 * Gives the lanes a clip-identity edit migrates the ids its compiled command recorded, in the
 * order the edit created them. A planner draws fresh lane ids; a command carrying its plan must
 * keep the ones it recorded, or the lanes it commits are not the objects its receipt names.
 *
 * Without supplied ids the lanes keep their drawn ids. With them, the count must match, each id
 * must be distinct and non-empty, and none may name a lane that already lives in the project;
 * otherwise the supplied plan cannot be this project's and the answer is `null`.
 */
export function keyMigratedAutomationLanes(
    lanes: readonly AutomationLaneValue[],
    laneIds: readonly string[] | undefined
): AutomationLaneValue[] | null {
    if (laneIds === undefined) {
        return [...lanes];
    }
    if (laneIds.length !== lanes.length || new Set(laneIds).size !== laneIds.length) {
        return null;
    }
    const liveLaneIds = new Set(getAutomationLanes().map((lane) => lane.id));
    if (laneIds.some((laneId) => laneId.length === 0 || liveLaneIds.has(laneId))) {
        return null;
    }
    return lanes.map((lane, index) => {
        const laneId = laneIds[index]!;
        return { ...lane, id: laneId, objects: lane.objects.map((object) => ({ ...object, laneId })) };
    });
}
