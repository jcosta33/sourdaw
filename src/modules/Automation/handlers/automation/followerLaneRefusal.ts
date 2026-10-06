import { type AutomationLane } from '../../models/Automation';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

/**
 * A linked follower lane plays its source lane's points — `resolveLinkedLane`
 * routes every read there and ignores the follower's own array — so a transform
 * written to the follower would be inaudible. The refusal names the source lane
 * the edit belongs to. Returns null for a missing or non-linked lane, leaving
 * the handler's own noop and existence paths in charge.
 */
export function findFollowerLaneRefusal(laneId: string): string | null {
    const lane: AutomationLane | undefined = getAutomationStoreState()?.lanes.find(
        (candidate) => candidate.id === laneId
    );
    if (!lane?.linkedLaneId) {
        return null;
    }
    return `Lane "${lane.parameterName}" follows automation lane ${lane.linkedLaneId}; transform its source lane instead.`;
}
