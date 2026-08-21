import { setOfflinePpqEndpointProjector } from '../repositories/offlineScheduler/setOfflinePpqEndpointProjector';

type ConfigureOfflinePpqEndpointProjectionInput = Parameters<typeof setOfflinePpqEndpointProjector>[0];

export function configureOfflinePpqEndpointProjection(input: ConfigureOfflinePpqEndpointProjectionInput): void {
    setOfflinePpqEndpointProjector(input);
}
