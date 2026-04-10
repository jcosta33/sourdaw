import { inject } from '#/infra/di/inject';
import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export const undoLastLayer = inject({ loopStationStore })(({ loopStationStore: store }) => {
    return function undoLastLayer(slotId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({
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
    };
});
