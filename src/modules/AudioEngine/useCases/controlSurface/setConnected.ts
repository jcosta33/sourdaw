import { controlSurfaceStore } from '#/modules/AudioEngine/stores/controlSurface';

export function setConnected(connected: boolean): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({ ...state, connected });
}
