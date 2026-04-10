import { inject } from '#/infra/di/inject';
import { setlistStore, type SetlistItem } from '#/modules/Transport/stores/setlistStore';

export const updateSetlistItem = inject({ setlistStore })(({ setlistStore: store }) => {
    return function updateSetlistItem(id: string, updates: Partial<Omit<SetlistItem, 'id'>>): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({
            ...state,
            items: state.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
        });
    };
});
