import { inject } from '#/infra/di/inject';
import { setlistStore } from '#/modules/Transport/stores/setlistStore';

export const toggleAutoAdvance = inject({ setlistStore })(({ setlistStore: store }) => {
    return function toggleAutoAdvance(): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, autoAdvance: !state.autoAdvance });
    };
});
