import { loopStationStore } from '../../stores/loopStationStore';

/**
 * Stop a single slot. A slot stopped part-way through its *first* recording
 * has captured nothing committed — `toggleRecord` only commits a layer when
 * the recording pass ends — so it returns to `empty` rather than to `stopped`,
 * matching hardware loopers (BOSS RC-505mkII: stopping an unfinished first
 * recording discards it and the track is empty again). Leaving it `stopped`
 * lit an amber cell with `layers: []` in the grid: a cell that claims content
 * it does not have (F5). Stopping an overdub keeps every committed layer.
 */
export function stopSlot(slotId: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((slot) => {
            if (slot.id !== slotId) {
                return slot;
            }
            if (slot.state === 'recording' && slot.layers.length === 0) {
                return { ...slot, state: 'empty' as const, lengthBeats: 0 };
            }
            return { ...slot, state: 'stopped' as const };
        }),
    });
}
