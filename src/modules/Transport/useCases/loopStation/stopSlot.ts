import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export function stopSlot(slotId: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((s) =>
            s.id === slotId ? { ...s, state: 'stopped' as const } : s
        ),
    });
}
