import { controlSurfaceStore } from '#/modules/AudioEngine/stores/controlSurface';

export function removeOscEndpoint(id: string): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({
        ...state,
        oscEndpoints: state.oscEndpoints.filter((e) => e.id !== id),
    });
}
