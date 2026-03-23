import { setlistStore } from '#/modules/Transport/stores/setlistStore';

export function setCountIn(bars: number): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    setlistStore.set({ ...state, countInBars: bars });
}
