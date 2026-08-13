import { addSidechainRouteSnapshot, getSidechainTargetCapability } from '#/modules/Routing/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type SidechainRouteSnapshot } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';

type AddSidechainRouteAction = Extract<AppAction, { type: 'addSidechainRoute' }>;
type RouteResolution =
    { status: 'resolved'; route: SidechainRouteSnapshot } | { status: 'absent' } | { status: 'conflict' };

function resolveRoute(action: AddSidechainRouteAction): RouteResolution {
    const tracks = getTrackStoreState()?.tracks;
    const sourceTrack = tracks?.find((track) => track.id === action.payload.sourceTrackId);
    const targetTrack = tracks?.find((track) => track.id === action.payload.targetTrackId);
    if (!targetTrack) {
        return { status: 'absent' };
    }
    const sourceLocked = sourceTrack?.clips.some((clip) => clip.locked) === true;
    const targetLocked = targetTrack.clips.some((clip) => clip.locked);
    if (sourceTrack?.frozen === true || targetTrack.frozen || sourceLocked || targetLocked) {
        return { status: 'conflict' };
    }

    const supportedDevices = targetTrack.devices.flatMap((device) => {
        const capability = getSidechainTargetCapability(device.type);
        return capability ? [{ device, capability }] : [];
    });
    let targetDeviceId = action.payload.targetDeviceId;
    let targetParameterId: string;
    if (targetDeviceId) {
        const target = supportedDevices.find(({ device }) => device.id === targetDeviceId);
        if (!target) {
            return { status: 'conflict' };
        }
        targetParameterId = target.capability.targetParameterId;
    } else {
        if (supportedDevices.length === 0) {
            return { status: 'absent' };
        }
        if (supportedDevices.length !== 1) {
            return { status: 'conflict' };
        }
        const target = supportedDevices[0]!;
        targetDeviceId = target.device.id;
        targetParameterId = target.capability.targetParameterId;
    }

    const routeId = action.payload.routeId ?? `sidechain-${crypto.randomUUID()}`;
    if (action.payload.targetParameterId !== undefined && action.payload.targetParameterId !== targetParameterId) {
        return { status: 'conflict' };
    }
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
    validate: (action) => resolveRoute(action).status !== 'conflict',
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
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
