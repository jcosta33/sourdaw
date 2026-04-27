import { toasterStore } from '../../stores/toasterStore';

export function setMorphTarget(deviceId: string, patternId: string | null): void {
    const state = toasterStore.value?.[deviceId];
    if (!state) {
        return;
    }
    toasterStore.set({
        ...toasterStore.value,
        [deviceId]: {
            ...state,
            morph: { ...state.morph, targetPatternId: patternId, enabled: patternId !== null },
        },
    });
}
