import { unwireSidechainRoute, wireSidechainRoute } from '#/modules/AudioEngine/useCases';

import { type SidechainRoute } from '../../models/SidechainRoute';
import { sidechainStore } from '../../stores/sidechainStore';

export function setSidechainRoutes(routes: SidechainRoute[]): void {
    const state = sidechainStore.value;
    if (state) {
        for (const route of state.routes) {
            unwireSidechainRoute(route.sourceTrackId, route.targetDeviceId);
        }
    }

    sidechainStore.set({ routes });

    for (const route of routes) {
        wireSidechainRoute(route.sourceTrackId, route.targetTrackId, route.targetDeviceId);
    }
}
