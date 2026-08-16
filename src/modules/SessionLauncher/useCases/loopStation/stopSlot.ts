import { loopStationStore } from '../../stores/loopStationStore';

/**
 * Stop a single slot. A slot with no committed layers has nothing to hold in
 * `stopped` — `toggleRecord` only commits a layer when the recording pass
 * ends — so it returns to `empty`, matching hardware loopers (BOSS RC-505mkII:
 * stopping an unfinished first recording discards it and the track is empty
 * again). The gate is the layer count alone, not the prior state: the Stop
 * button has no disabled guard, so stopping an `empty` slot must not promote
 * it to `stopped` either — an amber cell with `layers: []` claims content it
 * does not have (F5). Stopping an overdub keeps every committed layer.
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
            if (slot.layers.length === 0) {
                return { ...slot, state: 'empty' as const, lengthBeats: 0 };
            }
            return { ...slot, state: 'stopped' as const };
        }),
    });
}
