import { loopStationStore } from '../../stores/loopStationStore';

export function undoLastLayer(slotId: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({
        ...state,
        slots: state.slots.map((s) => {
            if (s.id !== slotId || s.layers.length === 0) {
                return s;
            }
            const layers = s.layers.slice(0, -1);
            return {
                ...s,
                layers,
                state: layers.length === 0 ? ('empty' as const) : s.state,
            };
        }),
    });
}
