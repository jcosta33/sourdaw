import { controlSurfaceStore, type McuState } from '../../stores/controlSurface';

export function mcuSetMode(mode: McuState['mode']): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    const displayMap = { pan: 'PAN', send: 'SND', plugin: 'PLG' } as const;
    controlSurfaceStore.set({
        ...state,
        mcu: { ...state.mcu, mode, assignmentDisplay: displayMap[mode] },
    });
}
