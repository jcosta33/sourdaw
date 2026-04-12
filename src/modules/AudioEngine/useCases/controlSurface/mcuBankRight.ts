import { controlSurfaceStore } from '../../stores/controlSurface';

export function mcuBankRight(totalTracks: number): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    const maxOffset = Math.max(0, totalTracks - 8);
    controlSurfaceStore.set({
        ...state,
        mcu: {
            ...state.mcu,
            bankOffset: Math.min(maxOffset, state.mcu.bankOffset + 8),
            faders: state.mcu.faders.map((f, i) => ({
                ...f,
                trackIndex: Math.min(maxOffset, state.mcu.bankOffset + 8) + i,
            })),
        },
    });
}
