import { inject } from '#/infra/di/inject';
import { loopStationStore, type LoopSlot } from '#/modules/Transport/stores/loopStationStore';
import { getNextSlotId } from '../../repositories/loopStationIdCounter';

export const createSlot = inject({ loopStationStore })(({ loopStationStore: store }) => {
    return function createSlot(trackId: string, row: number, column: number): void {
        const state = store.value;
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

        store.set({ ...state, slots: [...state.slots, slot] });
    };
});
