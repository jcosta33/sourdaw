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

/** The ids of the lanes a lane follows, directly or through other followers, that `ids` does not hold. */
function addLeaderIds(lanes: readonly AutomationLane[], ids: Set<string>): void {
    const byId = new Map(lanes.map((lane) => [lane.id, lane]));
    for (const id of [...ids]) {
        let leaderId = byId.get(id)?.linkedLaneId;
        while (leaderId !== undefined && !ids.has(leaderId)) {
            ids.add(leaderId);
            leaderId = byId.get(leaderId)?.linkedLaneId;
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
    addLeaderIds(lanes, ids);
    const selected = lanes.filter((lane) => ids.has(lane.id));
    for (const lane of selected) {
        takeRefs(listPrintedFieldRefs(readPrintedAutomationLane(lane)));
    }
    return selected;
}
