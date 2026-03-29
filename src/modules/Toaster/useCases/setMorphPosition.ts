import { toasterStore } from '../stores/toasterStore';

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

export function setMorphTarget(patternId: string | null): void {
    const state = toasterStore.value;
    if (!state) {
        return;
    }
    toasterStore.set({
        ...state,
        morph: { ...state.morph, targetPatternId: patternId, enabled: patternId !== null },
    });
}

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
