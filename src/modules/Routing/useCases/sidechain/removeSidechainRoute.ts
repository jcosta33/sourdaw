import { unwireSidechainRoute } from '#/modules/AudioEngine/useCases';

import { sidechainStore } from '../../stores/sidechainStore';

export function removeSidechainRoute(routeId: string): void {
    const state = sidechainStore.value;
    if (!state) {
        return;
    }

    const route = state.routes.find((r) => r.id === routeId);
    if (route) {
        unwireSidechainRoute(route.sourceTrackId, route.targetDeviceId);
    }

    sidechainStore.set({
        routes: state.routes.filter((r) => r.id !== routeId),
    });
}
