import { toasterStore } from '../../stores/toasterStore';

export function setMorphPosition(position: number): void {
    const state = toasterStore.value;
    if (!state) {
        return;
    }
    toasterStore.set({
        ...state,
        morph: { ...state.morph, position: Math.max(0, Math.min(1, position)) },
    });
}
