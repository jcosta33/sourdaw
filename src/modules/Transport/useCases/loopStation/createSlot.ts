import { pushUndoEntry } from '#/modules/Command/stores';

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

    const previousSlots = state.slots;
    const nextSlots = [...state.slots, slot];
    loopStationStore.set({ ...state, slots: nextSlots });

    pushUndoEntry(
        'Create loop slot',
        () => {
            const current = loopStationStore.value;
            if (!current) {
                return;
            }
            loopStationStore.set({ ...current, slots: previousSlots });
        },
        () => {
            const current = loopStationStore.value;
            if (!current) {
                return;
            }
            loopStationStore.set({ ...current, slots: nextSlots });
        }
    );
}
