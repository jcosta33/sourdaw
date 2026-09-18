import { createTakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { pushTargetedTakeLaneUndoEntry } from './takeLaneUndo';

export function addTakeLane(trackId: string): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some((lane) => lane.trackId === trackId);
    if (exists) {
        return;
    }

    const lane = createTakeLane(trackId);
    takeLaneStore.set({
        lanes: [...state.lanes, lane],
    });

    // The entry captures only the added lane (#4081): replaying a whole-store
    // snapshot on undo erased every later edit to any other lane.
    pushTargetedTakeLaneUndoEntry({
        kind: 'lane-added',
        label: 'Add take lane',
        lane,
        laneIndex: state.lanes.length,
    });
}
