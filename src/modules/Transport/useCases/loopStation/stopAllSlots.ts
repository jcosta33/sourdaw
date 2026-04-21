import { loopStationStore } from '../../stores/loopStationStore';

export function stopAllSlots(): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((state1) =>
            state1.state === 'playing' || state1.state === 'overdubbing' ? { ...state1, state: 'stopped' as const } : state1
        ),
    });
}
