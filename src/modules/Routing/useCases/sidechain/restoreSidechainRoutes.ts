import { type SidechainRoute } from '../../models/SidechainRoute';
import { sidechainStore } from '../../stores/sidechainStore';

import { wireSidechainRoutes } from './wireSidechainRoutes';

type RestorableSidechainRoute = Readonly<SidechainRoute>;

type RestoreSidechainRoutesOptions = {
    deferRuntimeEffect?: boolean;
};

function copyRoute(route: RestorableSidechainRoute): SidechainRoute {
    return {
        id: route.id,
        sourceTrackId: route.sourceTrackId,
        targetTrackId: route.targetTrackId,
        targetDeviceId: route.targetDeviceId,
        targetParameterId: route.targetParameterId,
        gain: route.gain,
    };
}

export function restoreSidechainRoutes(
    routes: readonly RestorableSidechainRoute[],
    options: RestoreSidechainRoutesOptions = {}
): () => void {
    const state = sidechainStore.value;
    if (!state) {
        return () => undefined;
    }

    const restored = [...state.routes];
    for (const route of routes) {
        if (!restored.some(({ id }) => id === route.id)) {
            restored.push(copyRoute(route));
        }
    }
    sidechainStore.set({ routes: restored });

    let runtimeEffectFinalized = false;
    function finalizeRuntimeEffect(): void {
        if (runtimeEffectFinalized) {
            return;
        }
        wireSidechainRoutes();
        runtimeEffectFinalized = true;
    }
    if (!options.deferRuntimeEffect) {
        finalizeRuntimeEffect();
    }
    return finalizeRuntimeEffect;
}
