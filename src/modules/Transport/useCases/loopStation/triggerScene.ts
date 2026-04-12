import { loopStationStore } from '../../stores/loopStationStore';

export function triggerScene(column: number): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        activeScene: column,
        slots: state.slots.map((s) => {
            if (s.column === column && s.layers.length > 0) {
                return { ...s, state: 'playing' as const };
            }
            if (s.column !== column && s.state === 'playing') {
                return { ...s, state: 'stopped' as const };
            }
            return s;
        }),
    });
}
