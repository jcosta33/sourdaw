import { inject } from '#/infra/di/inject';
import { setlistStore } from '#/modules/Transport/stores/setlistStore';

export const setCountIn = inject({ setlistStore })(({ setlistStore: store }) => {
    return function setCountIn(bars: number): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, countInBars: bars });
    };
});
