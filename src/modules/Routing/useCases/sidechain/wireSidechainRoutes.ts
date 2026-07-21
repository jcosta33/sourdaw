import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { wireSidechainRoute } from '#/modules/AudioEngine/useCases';

import { sidechainStore } from '../../stores/sidechainStore';

/**
 * Replays every persisted sidechain route from project truth into the audio
 * engine. Unlike {@link setSidechainRoutes} it does not mutate the store or
 * unwire anything — it only (re)issues the engine wiring for routes that are
 * already the source of truth.
 *
 * Used during strip setup (see Transport's `ensureTrackStrips`) so a project
 * saved with sidechain routing has its compression re-wired on load, mirroring
 * how track sends are re-applied. The engine's own pending-route replay handles
 * routes issued before the target strip/device exists.
 */
export function wireSidechainRoutes(): void {
    const state = sidechainStore.value;
    if (!state) {
        return;
    }
    const tracks = trackStore.value?.tracks;
    for (const route of state.routes) {
        const sourceTrack = tracks?.find((track) => track.id === route.sourceTrackId);
        const targetTrack = tracks?.find((track) => track.id === route.targetTrackId);
        if (sourceTrack && !getTrackEligibility(sourceTrack.kind).acceptsRoutingEndpoint) {
            continue;
        }
        if (targetTrack && !getTrackEligibility(targetTrack.kind).acceptsRoutingEndpoint) {
            continue;
        }
        wireSidechainRoute(route.sourceTrackId, route.targetTrackId, route.targetDeviceId);
    }
}
