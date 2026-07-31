import { unwireSidechainRoute, wireSidechainRoute } from '#/modules/AudioEngine/useCases';

import { sidechainStore } from '../../stores/sidechainStore';

type ReconcileSidechainRouteRuntimeInput = {
    sourceTrackId: string;
    targetDeviceId: string;
};

export function reconcileSidechainRouteRuntime({
    sourceTrackId,
    targetDeviceId,
}: ReconcileSidechainRouteRuntimeInput): void {
    const durableRoutes =
        sidechainStore.value?.routes.filter(
            (route) => route.sourceTrackId === sourceTrackId && route.targetDeviceId === targetDeviceId
        ) ?? [];

    unwireSidechainRoute(sourceTrackId, targetDeviceId);
    if (durableRoutes.length !== 1) {
        return;
    }

    const durableRoute = durableRoutes[0]!;
    wireSidechainRoute(durableRoute.sourceTrackId, durableRoute.targetTrackId, durableRoute.targetDeviceId);
}
