import { toasterStore } from '../../stores/toasterStore';

export function setMorphPosition(deviceId: string, position: number): void {
    const state = toasterStore.value?.[deviceId];
    if (!state) {
        return;
    }
    toasterStore.set({
        ...toasterStore.value,
        [deviceId]: {
            ...state,
            morph: { ...state.morph, position: Math.max(0, Math.min(1, position)) },
        }
    });
}
