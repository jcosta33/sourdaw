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
 * Adds to `ids` the lanes a lane follows, directly or through other followers. The render resolves a
 * target lane's links over a list without the target's own fader and pan lanes, so a chain that
 * starts on the target stops at one of them and reads nothing past it. Any other track's lanes
 * resolve over the full list, so its chain reads those lanes and walks on through them.
 */
function addLeaderIds(lanes: readonly AutomationLane[], ids: Set<string>, targetTrackId: string): void {
    const byId = new Map(lanes.map((lane) => [lane.id, lane]));
    for (const id of [...ids]) {
        const follower = byId.get(id);
        if (!follower) {
            continue;
        }
        const seen = new Set([id]);
        let leaderId = follower.linkedLaneId;
        while (leaderId !== undefined && !seen.has(leaderId)) {
            const leader = byId.get(leaderId);
            if (!leader || (follower.trackId === targetTrackId && drivesTrackMixer(leader, targetTrackId))) {
                break;
            }
            seen.add(leaderId);
            ids.add(leaderId);
            leaderId = leader.linkedLaneId;
        }
    }
}

/**
 * The lanes a keep-live subgraph render reads: those on the subgraph's tracks except the target's own
 * fader and pan lanes, which stay live, and the leader of any follower among them, whose points the
 * follower prints from wherever its track sits, the target's own fader and pan lanes included when
 * a follower on another track reads them. A lane is taken by the fields the scheduler reads, so
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
