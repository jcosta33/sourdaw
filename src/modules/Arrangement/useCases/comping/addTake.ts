import { createTake, type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { pushTargetedTakeLaneUndoEntry } from './takeLaneUndo';

export function addTake(
    trackId: string,
    clipId: string,
    name: string,
    startBeat: number,
    endBeat: number,
    sourceOffsetBeats?: number
): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    const lane = state.lanes.find((l) => l.trackId === trackId);
    if (!lane) {
        return;
    }

    const take = createTake(clipId, name, startBeat, endBeat, sourceOffsetBeats);
    const nextLane: TakeLane = { ...lane, takes: [...lane.takes, take] };
    takeLaneStore.set({
        lanes: state.lanes.map((l) => (l.trackId === trackId ? nextLane : l)),
    });

    // The entry captures only this lane's takes (#4081): replaying a
    // whole-store snapshot on undo erased every later edit to any lane.
    pushTargetedTakeLaneUndoEntry({
        kind: 'facet',
        label: `Add take: ${name}`,
        laneId: lane.id,
        before: { kind: 'takes', value: lane.takes },
        after: { kind: 'takes', value: nextLane.takes },
    });
}
