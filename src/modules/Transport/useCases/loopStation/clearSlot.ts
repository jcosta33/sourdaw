import { loopStationStore } from '../../stores/loopStationStore';

export function clearSlot(slotId: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((state1) =>
            state1.id === slotId ? { ...state1, state: 'empty' as const, layers: [], lengthBeats: 0, loopCount: 0 } : state1
        ),
    });
}
