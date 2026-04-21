import { setlistStore, type SetlistItem } from '../../stores/setlistStore';

export function updateSetlistItem(id: string, updates: Partial<Omit<SetlistItem, 'id'>>): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    setlistStore.set({
        ...state,
        items: state.items.map((index) => (index.id === id ? { ...index, ...updates } : index)),
    });
}
