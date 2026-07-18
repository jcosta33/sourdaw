import { controlSurfaceStore, getNextOscEndpointId } from '../../stores/controlSurface';

export function addOscEndpoint(host: string, sendPort: number, receivePort: number): void {
    const state = controlSurfaceStore.value;
    if (!state) {
        return;
    }
    controlSurfaceStore.set({
        ...state,
        oscEndpoints: [
            ...state.oscEndpoints,
            {
                id: getNextOscEndpointId(),
                host,
                sendPort,
                receivePort,
                active: true,
            },
        ],
    });
}
