import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export function stopAllSlots(): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((s) =>
            s.state === 'playing' || s.state === 'overdubbing'
                ? { ...s, state: 'stopped' as const }
                : s
        ),
    });
}
