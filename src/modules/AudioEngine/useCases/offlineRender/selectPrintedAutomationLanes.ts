import { drivesTrackMixer } from './drivesTrackMixer';
import { listPrintedFieldRefs } from './listPrintedFieldRefs';
import { type OfflineRenderProjectSource } from './OfflineRenderSource';
import { readPrintedAutomationLane } from './readPrintedAutomationLane';

type AutomationLane = OfflineRenderProjectSource['automationLanes'][number];

type SelectPrintedAutomationLanesInput = {
    lanes: readonly AutomationLane[];
    memberIds: ReadonlySet<string>;
    targetTrackId: string;
    /** Receives every reference the selected lanes were read from. */
    takeRefs: (refs: readonly unknown[]) => void;
};

/**
 * Adds to `ids` the lanes a lane follows, directly or through other followers. The walk stops at a
 * lane that drives the target's own fader or pan: the render drops those from every lane list, a
 * leader included, so it never reads one.
 */
function addLeaderIds(lanes: readonly AutomationLane[], ids: Set<string>, targetTrackId: string): void {
    const byId = new Map(lanes.map((lane) => [lane.id, lane]));
    for (const id of [...ids]) {
        let leaderId = byId.get(id)?.linkedLaneId;
        while (leaderId !== undefined && !ids.has(leaderId)) {
            const leader = byId.get(leaderId);
            if (!leader || drivesTrackMixer(leader, targetTrackId)) {
                break;
            }
            ids.add(leaderId);
            leaderId = leader.linkedLaneId;
        }
    }
}

/**
 * The lanes a keep-live subgraph render reads: those on the subgraph's tracks except the target's own
 * fader and pan lanes, which stay live, and the leader of any follower among them, whose points the
 * follower prints from wherever its track sits. A lane is taken by the fields the scheduler reads, so
 * a write to a view-only field selects the same input.
 */
export function selectPrintedAutomationLanes({
    lanes,
    memberIds,
    targetTrackId,
    takeRefs,
}: SelectPrintedAutomationLanesInput): AutomationLane[] {
    const ids = new Set(
        lanes
            .filter((lane) => memberIds.has(lane.trackId) && !drivesTrackMixer(lane, targetTrackId))
            .map((lane) => lane.id)
    );
    addLeaderIds(lanes, ids, targetTrackId);
    const selected = lanes.filter((lane) => ids.has(lane.id));
    for (const lane of selected) {
        takeRefs(listPrintedFieldRefs(readPrintedAutomationLane(lane)));
    }
    return selected;
}
