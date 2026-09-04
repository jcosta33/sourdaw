import { loopStationStore } from '../../stores/loopStationStore';

export function stopAllSlots(): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((slot) => {
            if (slot.state !== 'playing' && slot.state !== 'overdubbing' && slot.state !== 'recording') {
                return slot;
            }
            if (slot.layers.length === 0) {
                return { ...slot, state: 'empty' as const, lengthBeats: 0 };
            }
            return { ...slot, state: 'stopped' as const };
        }),
    });
}
