import { controlSurfaceStore } from '#/modules/AudioEngine/stores/controlSurface';

export function mcuBankLeft(): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({
        ...state,
        mcu: {
            ...state.mcu,
            bankOffset: Math.max(0, state.mcu.bankOffset - 8),
            faders: state.mcu.faders.map((f, i) => ({
                ...f,
                trackIndex: Math.max(0, state.mcu.bankOffset - 8) + i,
            })),
        },
    });
}
