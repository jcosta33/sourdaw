import { controlSurfaceStore } from '#/modules/AudioEngine/stores/controlSurface';

export function addOscMapping(
    oscAddress: string,
    actionType: string,
    parameterPath: string,
    min: number = 0,
    max: number = 1
): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({
        ...state,
        oscMappings: [...state.oscMappings, { oscAddress, actionType, parameterPath, min, max }],
    });
}
