import { getSidechainRoutesForTrack, removeSidechainRouteSnapshot } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type SidechainRouteSnapshot } from '#/utils/handlerContract';

type RemoveSidechainRouteAction = Extract<AppAction, { type: 'removeSidechainRoute' }>;
type RouteResolution =
    { status: 'resolved'; route: SidechainRouteSnapshot } | { status: 'absent' } | { status: 'conflict' };

function resolveRoute(action: RemoveSidechainRouteAction): RouteResolution {
    const { payload } = action;
    const { gain, routeId, targetDeviceId, targetParameterId } = payload;
    const hasCompleteSnapshot =
        routeId !== undefined && targetDeviceId !== undefined && targetParameterId !== undefined && gain !== undefined;
    if (hasCompleteSnapshot) {
        return {
            status: 'resolved',
            route: {
                id: routeId,
                sourceTrackId: payload.sourceTrackId,
                targetTrackId: payload.targetTrackId,
                targetDeviceId,
                targetParameterId,
                gain,
            },
        };
    }

    const hasPartialSnapshot =
        payload.routeId !== undefined ||
        payload.targetDeviceId !== undefined ||
        payload.targetParameterId !== undefined ||
        payload.gain !== undefined;
    if (hasPartialSnapshot) {
        return { status: 'conflict' };
    }

    const matchingRoutes = getSidechainRoutesForTrack(payload.targetTrackId).filter(
        (route) => route.sourceTrackId === payload.sourceTrackId
    );
    if (matchingRoutes.length === 0) {
        return { status: 'absent' };
    }
    if (matchingRoutes.length !== 1) {
        return { status: 'conflict' };
    }

    const route = matchingRoutes[0]!;
    action.payload.routeId = route.id;
    action.payload.targetDeviceId = route.targetDeviceId;
    action.payload.targetParameterId = route.targetParameterId;
    action.payload.gain = route.gain;
    return { status: 'resolved', route };
}

export const handleRemoveSidechainRoute = createHandler<'removeSidechainRoute'>({
    materializeCommandArguments: (action) => {
        if (resolveRoute(action).status === 'conflict') {
            throw new Error('Sidechain route arguments conflict with current project state');
        }
    },
    execute: (action) => {
        const resolution = resolveRoute(action);
        if (resolution.status === 'absent') {
            return { status: 'no-write' };
        }
        if (resolution.status === 'conflict') {
            return { status: 'conflict' };
        }
        return removeSidechainRouteSnapshot(resolution.route);
    },
    describe: (action) => {
        const resolution = resolveRoute(action);
        if (resolution.status !== 'resolved') {
            return {
                label: 'Remove sidechain route',
                inverseAction: null,
            };
        }
        return {
            label: 'Remove sidechain route',
            inverseAction: {
                type: 'addSidechainRoute',
                payload: {
                    sourceTrackId: resolution.route.sourceTrackId,
                    targetTrackId: resolution.route.targetTrackId,
                    routeId: resolution.route.id,
                    targetDeviceId: resolution.route.targetDeviceId,
                    targetParameterId: resolution.route.targetParameterId,
                    gain: resolution.route.gain,
                },
            },
        };
    },
    isNoop: (action) => resolveRoute(action).status === 'absent',
    requiresAbortCompensation: false,
    undoable: true,
});
