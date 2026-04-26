import { controlSurfaceStore } from '../../stores/controlSurface';

export function removeOscEndpoint(id: string): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({
        ...state,
        oscEndpoints: state.oscEndpoints.filter((event) => event.id !== id),
    });
}
