import { controlSurfaceStore } from '../../stores/controlSurface';

export function mcuUpdateTimecode(bars: number, beats: number, ticks: number): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({
        ...state,
        mcu: {
            ...state.mcu,
            timecodeDisplay: `${String(bars).padStart(3, '0')}:${String(beats).padStart(2, '0')}:${String(ticks).padStart(3, '0')}`,
        },
    });
}
