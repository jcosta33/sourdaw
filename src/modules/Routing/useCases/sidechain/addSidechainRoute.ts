import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { wireSidechainRoute } from '#/modules/AudioEngine/useCases';
import { wouldCreateRoutingCycle } from '#/utils/routingCycle';

import { SidechainCycleError } from '../../errors/RoutingErrors';
import { createSidechainRoute } from '../../models/SidechainRoute';
import { sidechainStore } from '../../stores/sidechainStore';

// FX-2: this guard used to walk sidechain routes alone, so it could not see a
// return path that ran through an output or a send — A keys B, B sends back to
// A was accepted as acyclic. It now shares the one detector the send and output
// mutators use, over all three edge relations.

export function addSidechainRoute(
    sourceTrackId: string,
    targetTrackId: string,
    targetDeviceId: string,
    targetParameterId = 'threshold'
): boolean {
    const tracks = trackStore.value?.tracks;
    const sourceTrack = tracks?.find((track) => track.id === sourceTrackId);
    const targetTrack = tracks?.find((track) => track.id === targetTrackId);
    if (!sourceTrack || !getTrackEligibility(sourceTrack.kind).acceptsRoutingEndpoint) {
        return false;
    }
    if (!targetTrack || !getTrackEligibility(targetTrack.kind).acceptsRoutingEndpoint) {
        return false;
    }

    const state = sidechainStore.value;
    if (!state) {
        return false;
    }

    const exists = state.routes.some((r) => r.sourceTrackId === sourceTrackId && r.targetDeviceId === targetDeviceId);
    if (exists) {
        return false;
    }

    if (
        wouldCreateRoutingCycle({
            sourceId: sourceTrackId,
            targetId: targetTrackId,
            tracks: tracks ?? [],
            sidechainRoutes: state.routes,
        })
    ) {
        throw new SidechainCycleError(sourceTrackId, targetTrackId);
    }

    const route = createSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId, targetParameterId);
    sidechainStore.set({ routes: [...state.routes, route] });

    wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId);
    return true;
}
