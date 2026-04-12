import { loopStationStore } from '../../stores/loopStationStore';

export function clearSlot(slotId: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((s) =>
            s.id === slotId ? { ...s, state: 'empty' as const, layers: [], lengthBeats: 0, loopCount: 0 } : s
        ),
    });
}
