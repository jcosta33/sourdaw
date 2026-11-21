import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { projectDeviceChainAction } from './DeviceChainActionProjection';
import { type PluginDescriptor } from './DeviceParameterTypes';
import { type PlannedDeviceWrite } from './PlannedDeviceWrite';
import { type Device, createTrack } from './Track';

export type Owner = { id: string; frozen?: boolean; devices: Device[] };
export type PlanFailure = Exclude<PlannedDeviceWrite, { status: 'ready' }>;
export type OwnerProjection = { status: 'projected'; owners: Owner[] } | PlanFailure;
export type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

export function uniqueDevice(owners: readonly Owner[], deviceId: string) {
    const matches = owners.flatMap((owner) =>
        owner.devices.filter((device) => device.id === deviceId).map((device) => ({ owner, device }))
    );
    return matches.length === 1 ? matches[0] : undefined;
}

type ParameterExpectation = ActionOf<'setDeviceParameter'>['payload'];

function ownerMatchesExpectation(owner: Owner, p: ParameterExpectation): boolean {
    return (
        (p.expectedTrackId === undefined || owner.id === p.expectedTrackId) &&
        (p.expectedDeviceIds === undefined ||
            (p.expectedDeviceIds.length === owner.devices.length &&
                p.expectedDeviceIds.every((id, index) => owner.devices[index]?.id === id))) &&
        (p.expectedTrackFrozen === undefined || owner.frozen === p.expectedTrackFrozen)
    );
}

function deviceMatchesExpectation(device: Device, p: ParameterExpectation): boolean {
    const present = Object.hasOwn(device.parameterValues, p.paramId);
    return (
        (p.expectedDeviceType === undefined || device.type === p.expectedDeviceType) &&
        (p.expectedValuePresent === undefined || present === p.expectedValuePresent) &&
        (p.expectedValue === undefined || (present && device.parameterValues[p.paramId] === p.expectedValue))
    );
}

function parameterSourceMatches(owners: readonly Owner[], action: ActionOf<'setDeviceParameter'>): boolean {
    const target = uniqueDevice(owners, action.payload.deviceId);
    if (!target) {
        return false;
    }
    return (
        ownerMatchesExpectation(target.owner, action.payload) && deviceMatchesExpectation(target.device, action.payload)
    );
}

export function projectMaterializedTrack(action: ActionOf<'addTrack' | 'createBus'>, owners: Owner[]): OwnerProjection {
    const id = action.type === 'addTrack' ? action.payload.id : action.payload.busId;
    if (!id || owners.some((owner) => owner.id === id)) {
        return { status: 'conflict', reason: 'Planned track identity is unavailable' };
    }
    if (
        action.type === 'addTrack' &&
        action.payload.kind === 'midi' &&
        !action.payload.withoutDefaultDevice &&
        !action.payload.initialDeviceId
    ) {
        return { status: 'unsupported', reason: 'Track creation lacks its materialized device identity' };
    }
    let track: ReturnType<typeof createTrack>;
    if (action.type === 'addTrack') {
        track = createTrack({
            id,
            kind: action.payload.kind,
            name: action.payload.name ?? id,
            color: '#000000',
            initialAlternativeId: `planned-${id}`,
            initialDeviceId: action.payload.initialDeviceId,
            withoutDefaultDevice: action.payload.withoutDefaultDevice,
        });
    } else {
        track = createTrack({
            id,
            kind: 'bus',
            name: action.payload.name,
            color: '#000000',
            initialAlternativeId: `planned-${id}`,
        });
    }
    owners.push({ id, frozen: track.frozen, devices: track.devices });
    return { status: 'projected', owners };
}

export function projectEveryOwner(
    action: AppAction,
    owners: Owner[],
    plugins: readonly PluginDescriptor[]
): OwnerProjection {
    for (const owner of owners) {
        const devices = projectDeviceChainAction(owner.id, owner.devices, action, plugins);
        if (devices) {
            owner.devices = devices;
        }
    }
    return { status: 'projected', owners };
}

export function projectCapturedPatchUnsupported(): OwnerProjection {
    return { status: 'unsupported', reason: 'A current-format captured patch adapter is required' };
}

export function projectRemovedTrack(action: ActionOf<'removeTrack'>, owners: Owner[]): OwnerProjection {
    return { status: 'projected', owners: owners.filter((owner) => owner.id !== action.payload.trackId) };
}

export function projectRestoredTrackUnsupported(): OwnerProjection {
    return {
        status: 'unsupported',
        reason: 'The opaque track snapshot needs an owning planned-source adapter',
    };
}

export function projectParameterWrite(
    action: ActionOf<'setDeviceParameter'>,
    owners: Owner[],
    plugins: readonly PluginDescriptor[]
): OwnerProjection {
    if (!parameterSourceMatches(owners, action)) {
        return { status: 'conflict', reason: 'Planned parameter source changed' };
    }
    return projectEveryOwner(action, owners, plugins);
}
