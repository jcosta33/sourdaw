import { loopStationStore } from '../../stores/loopStationStore';

export function undoLastLayer(slotId: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((state1) => {
            if (state1.id !== slotId || state1.layers.length === 0) {
                return state1;
            }
            const layers = state1.layers.slice(0, -1);
            return {
                ...state1,
                layers,
                state: layers.length === 0 ? ('empty' as const) : state1.state,
            };
        }),
    });
}
