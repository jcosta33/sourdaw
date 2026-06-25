import { getEngineState, unwireSidechainRoute, wireSidechainRoute } from '#/modules/AudioEngine/useCases';

import { type SidechainRoute } from '../../models/SidechainRoute';
import { sidechainStore } from '../../stores/sidechainStore';

/**
 * Result of {@link setSidechainRoutes}. The store (project truth) is always
 * updated; `wiredLive` reports whether the engine could apply the wiring now.
 * When `false`, the engine was not ready (fallback / pre-init) and has queued
 * the routes for replay once it recovers — so the caller can surface a
 * recoverable state instead of assuming the live graph matches the store.
 */
export type SetSidechainRoutesResult = {
    wiredLive: boolean;
};

export function setSidechainRoutes(routes: SidechainRoute[]): SetSidechainRoutesResult {
    const state = sidechainStore.value;
    if (state) {
        for (const route of state.routes) {
            unwireSidechainRoute(route.sourceTrackId, route.targetDeviceId);
        }
    }

    sidechainStore.set({ routes });

    // Issue the wiring regardless of engine readiness: when the engine is in
    // fallback mode it now queues each route for replay rather than dropping it,
    // so the request is never silently lost. We report whether it was applied
    // live so the caller has visibility into the deferred (recoverable) state.
    const wiredLive = getEngineState().isReady;
    for (const route of routes) {
        wireSidechainRoute(route.sourceTrackId, route.targetTrackId, route.targetDeviceId);
    }

    return { wiredLive };
}
