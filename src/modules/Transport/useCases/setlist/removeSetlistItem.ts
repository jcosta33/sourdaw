import { inject } from '#/infra/di/inject';
import { setlistStore } from '#/modules/Transport/stores/setlistStore';

export const removeSetlistItem = inject({ setlistStore })(({ setlistStore: store }) => {
    return function removeSetlistItem(id: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        const removed = state.items.find((i) => i.id === id);
        store.set({
            ...state,
            items: state.items.filter((i) => i.id !== id),
            totalDuration: state.totalDuration - (removed?.estimatedDuration ?? 0),
        });
    };
});
