import { inject } from '#/infra/di/inject';
import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export const triggerScene = inject({ loopStationStore })(({ loopStationStore: store }) => {
    return function triggerScene(column: number): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({
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
    };
});
