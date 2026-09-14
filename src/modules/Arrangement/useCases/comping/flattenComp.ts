import { takeLaneStore } from '../../stores/takeLaneStore';

import { pushTargetedTakeLaneUndoEntry } from './takeLaneUndo';

export function flattenComp(trackId: string): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    const lane = state.lanes.find((l) => l.trackId === trackId);
    if (!lane) {
        return;
    }

    takeLaneStore.set({
        lanes: state.lanes.filter((l) => l.trackId !== trackId),
    });

    // The entry captures only the removed lane (#4081): replaying a
    // whole-store snapshot on undo erased every later edit to any other lane.
    pushTargetedTakeLaneUndoEntry({
        kind: 'lane-removed',
        label: 'Flatten comp',
        lane,
        laneIndex: state.lanes.indexOf(lane),
    });
}
