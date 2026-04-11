import { setlistStore } from '#/modules/Transport/stores/setlistStore';

export function renameSetlist(name: string): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    setlistStore.set({ ...state, name });
}
