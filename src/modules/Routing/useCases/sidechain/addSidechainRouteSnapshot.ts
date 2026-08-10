import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import { type HandlerExecutionResult } from '#/utils/handlerContract';
import { wouldCreateRoutingCycle } from '#/utils/routingCycle';

import { sidechainRoutesMatch, type SidechainRoute } from '../../models/SidechainRoute';
import { sidechainStore } from '../../stores/sidechainStore';

import { getSidechainTargetCapability } from './getSidechainTargetCapability';
import { reconcileSidechainRouteRuntime } from './reconcileSidechainRouteRuntime';

export function addSidechainRouteSnapshot(route: SidechainRoute): HandlerExecutionResult {
    if (route.sourceTrackId === route.targetTrackId) {
        return { status: 'conflict' };
    }

    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return { status: 'conflict' };
    }

    const sourceTrack = tracks.find((track) => track.id === route.sourceTrackId);
    const targetTrack = tracks.find((track) => track.id === route.targetTrackId);
    if (
        !sourceTrack ||
        !getTrackEligibility(sourceTrack.kind).acceptsRoutingEndpoint ||
        !targetTrack ||
        !getTrackEligibility(targetTrack.kind).acceptsRoutingEndpoint
    ) {
        return { status: 'conflict' };
    }

    const targetDevice = targetTrack.devices.find((device) => device.id === route.targetDeviceId);
    const capability = targetDevice ? getSidechainTargetCapability(targetDevice.type) : null;
    if (
        !capability ||
        route.targetParameterId !== capability.targetParameterId ||
        !route.id ||
        !Number.isFinite(route.gain)
    ) {
        return { status: 'conflict' };
    }

    const state = sidechainStore.value;
    if (!state) {
        return { status: 'conflict' };
    }

    const routeWithSameId = state.routes.find((candidate) => candidate.id === route.id);
    if (routeWithSameId) {
        if (sidechainRoutesMatch(routeWithSameId, route)) {
            return { status: 'no-write' };
        }
        return { status: 'conflict' };
    }

    const duplicateKey = state.routes.some(
        (candidate) =>
            candidate.sourceTrackId === route.sourceTrackId && candidate.targetDeviceId === route.targetDeviceId
    );
    if (duplicateKey) {
        return { status: 'conflict' };
    }

    if (
        wouldCreateRoutingCycle({
            sourceId: route.sourceTrackId,
            targetId: route.targetTrackId,
            tracks,
            sidechainRoutes: state.routes,
        })
    ) {
        return { status: 'conflict' };
    }

    sidechainStore.set({ routes: [...state.routes, route] });

    let commitEffectFinalized = false;
    let ambiguousCommitEffectFinalized = false;
    return {
        status: 'written',
        afterCommit: () => {
            if (commitEffectFinalized) {
                return;
            }
            reconcileSidechainRouteRuntime({
                sourceTrackId: route.sourceTrackId,
                targetDeviceId: route.targetDeviceId,
            });
            commitEffectFinalized = true;
        },
        afterAmbiguousCommit: () => {
            if (ambiguousCommitEffectFinalized) {
                return;
            }
            reconcileSidechainRouteRuntime({
                sourceTrackId: route.sourceTrackId,
                targetDeviceId: route.targetDeviceId,
            });
            ambiguousCommitEffectFinalized = true;
        },
    };
}
