import { setOfflinePpqEndpointProjector } from '../repositories/offlineScheduler/setOfflinePpqEndpointProjector';

type ConfigureOfflinePpqEndpointProjectionInput = {
    project: Parameters<typeof setOfflinePpqEndpointProjector>[0];
};

export function configureOfflinePpqEndpointProjection({ project }: ConfigureOfflinePpqEndpointProjectionInput): void {
    setOfflinePpqEndpointProjector(project);
}
