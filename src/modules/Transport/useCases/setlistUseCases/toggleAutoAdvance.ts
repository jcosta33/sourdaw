import { setlistStore } from '#/modules/Transport/stores/setlistStore';

export function toggleAutoAdvance(): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    setlistStore.set({ ...state, autoAdvance: !state.autoAdvance });
}
