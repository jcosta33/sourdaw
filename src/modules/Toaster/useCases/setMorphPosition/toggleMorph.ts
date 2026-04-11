import { toasterStore } from '../../stores/toasterStore';

export function toggleMorph(): void {
    const state = toasterStore.value;
    if (!state) {
        return;
    }
    toasterStore.set({
        ...state,
        morph: { ...state.morph, enabled: !state.morph.enabled },
    });
}