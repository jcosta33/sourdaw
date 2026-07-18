import { controlSurfaceStore } from '../../stores/controlSurface';

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
            faders: state.mcu.faders.map((freq, index) => ({
                ...freq,
                trackIndex: Math.max(0, state.mcu.bankOffset - 8) + index,
            })),
        },
    });
}
