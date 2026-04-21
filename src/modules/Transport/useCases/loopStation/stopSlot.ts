import { loopStationStore } from '../../stores/loopStationStore';

export function stopSlot(slotId: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((state1) => (state1.id === slotId ? { ...state1, state: 'stopped' as const } : state1)),
    });
}
