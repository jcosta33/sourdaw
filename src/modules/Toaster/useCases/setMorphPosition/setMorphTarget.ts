import { toasterStore } from '../../stores/toasterStore';

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