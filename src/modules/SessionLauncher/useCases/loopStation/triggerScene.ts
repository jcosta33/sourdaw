import { loopStationStore } from '../../stores/loopStationStore';

export function triggerScene(column: number): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        activeScene: column,
        slots: state.slots.map((state1) => {
            if (state1.column === column && state1.layers.length > 0) {
                return { ...state1, state: 'playing' as const };
            }
            if (state1.column !== column && (state1.state === 'playing' || state1.state === 'overdubbing')) {
                return { ...state1, state: 'stopped' as const };
            }
            return state1;
        }),
    });
}
