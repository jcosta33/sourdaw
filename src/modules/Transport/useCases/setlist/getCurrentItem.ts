import { inject } from '#/infra/di/inject';
import { setlistStore, type SetlistItem } from '#/modules/Transport/stores/setlistStore';

export const getCurrentItem = inject({ setlistStore })(({ setlistStore: store }) => {
    return function getCurrentItem(): SetlistItem | null {
        const state = store.value;
        if (!state || state.items.length === 0) {
            return null;
        }
        return state.items[state.currentIndex] ?? null;
    };
});
