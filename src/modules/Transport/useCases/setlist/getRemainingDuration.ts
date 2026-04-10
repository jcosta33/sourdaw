import { inject } from '#/infra/di/inject';
import { setlistStore } from '#/modules/Transport/stores/setlistStore';

export const getRemainingDuration = inject({ setlistStore })(({ setlistStore: store }) => {
    return function getRemainingDuration(): number {
        const state = store.value;
        if (!state) {
            return 0;
        }
        return state.items
            .slice(state.currentIndex)
            .reduce((sum, item) => sum + item.estimatedDuration + item.gapSeconds, 0);
    };
});
