import { inject } from '#/infra/di/inject';
import { setlistStore } from '#/modules/Transport/stores/setlistStore';

export const reorderSetlistItems = inject({ setlistStore })(({ setlistStore: store }) => {
    return function reorderSetlistItems(fromIndex: number, toIndex: number): void {
        const state = store.value;
        if (!state || fromIndex === toIndex) {
            return;
        }
        const items = [...state.items];
        const [moved] = items.splice(fromIndex, 1);
        if (moved) {
            items.splice(toIndex, 0, moved);
        }
        store.set({ ...state, items });
    };
});
