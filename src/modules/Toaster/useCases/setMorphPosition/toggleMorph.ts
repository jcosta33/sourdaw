import { toasterStore } from '../../stores/toasterStore';

export function toggleMorph(deviceId: string): void {
    const state = toasterStore.value?.[deviceId];
    if (!state) {
        return;
    }
    toasterStore.set({
        ...toasterStore.value,
        [deviceId]: {
            ...state,
            morph: { ...state.morph, enabled: !state.morph.enabled },
        }
    });
}
