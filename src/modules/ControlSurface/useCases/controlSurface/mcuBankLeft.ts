import { controlSurfaceStore } from '../../stores/controlSurface';

// Faders array is 8 channel faders (index 0-7) + 1 master fader (index 8).
// The master fader is a fixed hardware identity, not a channel strip — it
// must never be reassigned to a track index when banking (F-5).
const MASTER_FADER_INDEX = 8;

export function mcuBankLeft(): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    const newOffset = Math.max(0, state.mcu.bankOffset - 8);
    controlSurfaceStore.set({
        ...state,
        mcu: {
            ...state.mcu,
            bankOffset: newOffset,
            faders: state.mcu.faders.map((fader, index) => {
                if (index === MASTER_FADER_INDEX) {
                    return fader;
                }
                return {
                    ...fader,
                    trackIndex: newOffset + index,
                };
            }),
        },
    });
}
