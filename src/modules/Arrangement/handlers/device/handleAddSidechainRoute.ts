import { addSidechainRouteSnapshot } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type SidechainRouteSnapshot } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';

const SUPPORTED_SIDECHAIN_DEVICE_TYPE = 'builtin-sidechain-compressor';

type AddSidechainRouteAction = Extract<AppAction, { type: 'addSidechainRoute' }>;
type RouteResolution =
    { status: 'resolved'; route: SidechainRouteSnapshot } | { status: 'absent' } | { status: 'conflict' };

function resolveRoute(action: AddSidechainRouteAction): RouteResolution {
    const targetTrack = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.targetTrackId);
    if (!targetTrack) {
        return { status: 'absent' };
    }

    const supportedDevices = targetTrack.devices.filter((device) => device.type === SUPPORTED_SIDECHAIN_DEVICE_TYPE);
    let targetDeviceId = action.payload.targetDeviceId;
    if (targetDeviceId) {
        const ownsSupportedDevice = supportedDevices.some((device) => device.id === targetDeviceId);
        if (!ownsSupportedDevice) {
            return { status: 'conflict' };
        }
    } else {
        if (supportedDevices.length === 0) {
            return { status: 'absent' };
        }
        if (supportedDevices.length !== 1) {
            return { status: 'conflict' };
        }
        targetDeviceId = supportedDevices[0]!.id;
    }

    const routeId = action.payload.routeId ?? `sidechain-${crypto.randomUUID()}`;
    const targetParameterId = action.payload.targetParameterId ?? 'threshold';
    const gain = action.payload.gain ?? 1;
    action.payload.routeId = routeId;
    action.payload.targetDeviceId = targetDeviceId;
    action.payload.targetParameterId = targetParameterId;
    action.payload.gain = gain;

    return {
        status: 'resolved',
        route: {
            id: routeId,
            sourceTrackId: action.payload.sourceTrackId,
            targetTrackId: action.payload.targetTrackId,
            targetDeviceId,
            targetParameterId,
            gain,
        },
    };
}

export const handleAddSidechainRoute = createHandler<'addSidechainRoute'>({
    execute: (action) => {
        const resolution = resolveRoute(action);
        if (resolution.status === 'absent') {
            return { status: 'no-write' };
        }
        if (resolution.status === 'conflict') {
            return { status: 'conflict' };
        }
        return addSidechainRouteSnapshot(resolution.route);
    },
    describe: (action) => {
        const resolution = resolveRoute(action);
        if (resolution.status !== 'resolved') {
            return {
                label: 'Add sidechain route',
                inverseAction: null,
            };
        }
        return {
            label: 'Add sidechain route',
            inverseAction: {
                type: 'removeSidechainRoute',
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
