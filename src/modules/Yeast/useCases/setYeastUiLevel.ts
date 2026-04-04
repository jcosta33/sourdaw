import { yeastStore } from '../stores/yeastStore';

export function setYeastUiLevel(level: 1 | 2 | 3 | 4 | 5): void {
    const state = yeastStore.value;
    if (state) {
        yeastStore.set({ ...state, uiLevel: level });
    }
}
