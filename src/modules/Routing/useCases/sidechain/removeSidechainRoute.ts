import { unwireSidechainRoute } from '#/modules/AudioEngine/useCases';

import { sidechainStore } from '../../stores/sidechainStore';

type RemoveSidechainRouteOptions = {
    deferRuntimeEffect?: boolean;
};

export function removeSidechainRoute(routeId: string, options: RemoveSidechainRouteOptions = {}): (() => void) | null {
    const state = sidechainStore.value;
    if (!state) {
        return null;
    }

    const route = state.routes.find((r) => r.id === routeId);
    if (route) {
        if (!options.deferRuntimeEffect) {
            unwireSidechainRoute(route.sourceTrackId, route.targetDeviceId);
        }
    }

    sidechainStore.set({
        routes: state.routes.filter((r) => r.id !== routeId),
    });

    if (!route || !options.deferRuntimeEffect) {
        return null;
    }
    let runtimeEffectFinalized = false;
    return () => {
        if (runtimeEffectFinalized) {
            return;
        }
        unwireSidechainRoute(route.sourceTrackId, route.targetDeviceId);
        runtimeEffectFinalized = true;
    };
}
