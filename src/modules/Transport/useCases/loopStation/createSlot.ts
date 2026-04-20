import { getNextSlotId } from '../../repositories/loopStationIdCounter/getNextSlotId';
import { loopStationStore, type LoopSlot } from '../../stores/loopStationStore';

export function createSlot(trackId: string, row: number, column: number): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }

    const slot: LoopSlot = {
        id: getNextSlotId(),
        trackId,
        row,
        column,
        state: 'empty',
        lengthBeats: 0,
        layers: [],
        loopCount: 0,
        volume: 1,
        quantize: true,
        fadeBeats: 0.125,
    };

    loopStationStore.set({ ...state, slots: [...state.slots, slot] });
}
