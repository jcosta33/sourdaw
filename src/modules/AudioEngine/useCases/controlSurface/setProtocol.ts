import { controlSurfaceStore, type ControlSurfaceProtocol } from '../../stores/controlSurface';

export function setProtocol(protocol: ControlSurfaceProtocol | null): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({ ...state, protocol });
}
