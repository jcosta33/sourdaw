import { inject } from '#/infra/di/inject';
import { setlistStore } from '#/modules/Transport/stores/setlistStore';

export const getSetlistProgress = inject({ setlistStore })(({ setlistStore: store }) => {
    return function getSetlistProgress(): { current: number; total: number; percent: number } {
        const state = store.value;
        if (!state || state.items.length === 0) {
            return { current: 0, total: 0, percent: 0 };
        }
        return {
            current: state.currentIndex + 1,
            total: state.items.length,
            percent: ((state.currentIndex + 1) / state.items.length) * 100,
        };
    };
});
