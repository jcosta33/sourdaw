import { loopStationStore } from '../../stores/loopStationStore';

export function setFixedLoopLength(beats: number): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({ ...state, fixedLoopLength: beats });
}
