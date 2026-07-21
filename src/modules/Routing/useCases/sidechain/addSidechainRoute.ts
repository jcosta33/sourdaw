import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { wireSidechainRoute } from '#/modules/AudioEngine/useCases';

import { SidechainCycleError } from '../../errors/RoutingErrors';
import { createSidechainRoute, type SidechainRoute } from '../../models/SidechainRoute';
import { sidechainStore } from '../../stores/sidechainStore';

function wouldCreateCycle(sourceTrackId: string, targetTrackId: string, routes: SidechainRoute[]): boolean {
    if (sourceTrackId === targetTrackId) {
        return true;
    }
    const visited = new Set<string>();
    const queue = [targetTrackId];
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === sourceTrackId) {
            return true;
        }
        if (visited.has(current)) {
            continue;
        }
        visited.add(current);
        for (const route of routes) {
            if (route.sourceTrackId === current) {
                queue.push(route.targetTrackId);
            }
        }
    }
    return false;
}

export function addSidechainRoute(
    sourceTrackId: string,
    targetTrackId: string,
    targetDeviceId: string,
    targetParameterId = 'threshold'
): void {
    const tracks = trackStore.value?.tracks;
    const sourceTrack = tracks?.find((track) => track.id === sourceTrackId);
    const targetTrack = tracks?.find((track) => track.id === targetTrackId);
    if (sourceTrack && !getTrackEligibility(sourceTrack.kind).acceptsRoutingEndpoint) {
        return;
    }
    if (targetTrack && !getTrackEligibility(targetTrack.kind).acceptsRoutingEndpoint) {
        return;
    }

    const state = sidechainStore.value;
    if (!state) {
        return;
    }

    const exists = state.routes.some((r) => r.sourceTrackId === sourceTrackId && r.targetDeviceId === targetDeviceId);
    if (exists) {
        return;
    }

    if (wouldCreateCycle(sourceTrackId, targetTrackId, state.routes)) {
        throw new SidechainCycleError(sourceTrackId, targetTrackId);
    }

    const route = createSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId, targetParameterId);
    sidechainStore.set({ routes: [...state.routes, route] });

    wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId);
}
