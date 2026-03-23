import { takeLaneStore } from '#/modules/Clip/stores/takeLaneStore';
import { createTake } from '#/modules/Clip/models/TakeLane';

export function addTake(trackId: string, clipId: string, name: string, startBeat: number, endBeat: number): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    const take = createTake(clipId, name, startBeat, endBeat);

    takeLaneStore.set({
        lanes: state.lanes.map((l) => (l.trackId === trackId ? { ...l, takes: [...l.takes, take] } : l)),
    });
}
