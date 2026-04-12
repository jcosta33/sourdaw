import { controlSurfaceStore } from '../../stores/controlSurface';

export function mcuSetFader(faderIndex: number, position: number): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    const pos = Math.max(0, Math.min(1023, Math.round(position)));
    controlSurfaceStore.set({
        ...state,
        mcu: {
            ...state.mcu,
            faders: state.mcu.faders.map((f, i) => (i === faderIndex ? { ...f, position: pos } : f)),
        },
    });
}
