import { offlinePpqEndpointProjectorState, type OfflinePpqEndpointProjector } from './offlinePpqEndpointProjectorState';

export function setOfflinePpqEndpointProjector(project: OfflinePpqEndpointProjector): void {
    offlinePpqEndpointProjectorState.project = project;
}
