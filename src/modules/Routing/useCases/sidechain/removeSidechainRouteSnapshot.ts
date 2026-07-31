import { type HandlerExecutionResult } from '#/utils/handlerContract';

import { sidechainRoutesMatch, type SidechainRoute } from '../../models/SidechainRoute';
import { sidechainStore } from '../../stores/sidechainStore';

import { reconcileSidechainRouteRuntime } from './reconcileSidechainRouteRuntime';

export function removeSidechainRouteSnapshot(route: SidechainRoute): HandlerExecutionResult {
    const state = sidechainStore.value;
    if (!state) {
        return { status: 'conflict' };
    }

    const durableRoute = state.routes.find((candidate) => candidate.id === route.id);
    if (!durableRoute || !sidechainRoutesMatch(durableRoute, route)) {
        return { status: 'conflict' };
    }

    sidechainStore.set({
        routes: state.routes.filter((candidate) => candidate.id !== route.id),
    });

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
