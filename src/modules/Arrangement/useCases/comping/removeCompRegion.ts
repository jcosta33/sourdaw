import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { pushTargetedTakeLaneUndoEntry } from './takeLaneUndo';

export function removeCompRegion(trackId: string, startBeat: number): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    const lane = state.lanes.find((l) => l.trackId === trackId);
    if (!lane) {
        return;
    }
    if (!lane.activeCompRegions.some((r) => r.startBeat === startBeat)) {
        return;
    }

    const nextLane: TakeLane = {
        ...lane,
        activeCompRegions: lane.activeCompRegions.filter((r) => r.startBeat !== startBeat),
    };
    takeLaneStore.set({
        lanes: state.lanes.map((l) => (l.trackId === trackId ? nextLane : l)),
    });

    // The entry captures only this lane's comp regions (#4081): replaying a
    // whole-store snapshot on undo erased every later edit to any lane.
    pushTargetedTakeLaneUndoEntry({
        kind: 'facet',
        label: 'Remove comp region',
        laneId: lane.id,
        before: { kind: 'activeCompRegions', value: lane.activeCompRegions },
        after: { kind: 'activeCompRegions', value: nextLane.activeCompRegions },
    });
}
