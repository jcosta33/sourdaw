import { type AppAction } from '#/utils/handlerContract';

import { type PluginDescriptor } from './DeviceParameterTypes';
import { type DevicePatchState } from './DevicePatchState';
import {
    type PlannedDeviceOwnerSource,
    type PlannedDevicePresence,
    type PlannedDeviceWrite,
    type PlannedDeviceWriteStep,
} from './PlannedDeviceWrite';
import { projectCapturedDevicePatch } from './projectCapturedDevicePatch';
import { projectDeviceChainAction } from './projectDeviceChainAction';
import { projectDeviceSnapshots } from './projectDeviceSnapshots';
import { type Device, createTrack } from './Track';

type Owner = { id: string; frozen?: boolean; devices: Device[] };
type PlanInput = {
    source: readonly PlannedDeviceOwnerSource[];
    trackId: string;
    deviceId: string;
    parameterIds: readonly string[];
    steps: readonly PlannedDeviceWriteStep[];
    actionIndex: number;
    plugins: readonly PluginDescriptor[];
};

function uniqueDevice(owners: readonly Owner[], deviceId: string) {
    const matches = owners.flatMap((owner) =>
        owner.devices.filter((device) => device.id === deviceId).map((device) => ({ owner, device }))
    );
    return matches.length === 1 ? matches[0] : undefined;
}

function presence(owners: readonly Owner[], input: PlanInput): PlannedDevicePresence | null {
    const ownersWithId = owners.filter((owner) => owner.id === input.trackId);
    const occurrences = owners.flatMap((owner) => owner.devices.filter((device) => device.id === input.deviceId));
    if (ownersWithId.length > 1 || occurrences.length > 1) {
        return null;
    }
    const owner = ownersWithId[0];
    if (!owner) {
        return occurrences.length === 0
            ? { kind: 'absent-track', trackId: input.trackId, deviceId: input.deviceId }
            : null;
    }
    const device = owner.devices.find((candidate) => candidate.id === input.deviceId);
    const shared = {
        trackId: owner.id,
        deviceId: input.deviceId,
        deviceIds: owner.devices.map((candidate) => candidate.id),
        frozen: owner.frozen ?? false,
    };
    if (!device) {
        return occurrences.length === 0 ? { kind: 'absent-device', ...shared } : null;
    }
    if (Object.hasOwn(device, 'deviceState') && device.deviceState === undefined) {
        return null;
    }
    const parameterValues: DevicePatchState['parameterValues'] = {};
    for (const key of input.parameterIds) {
        const value = device.parameterValues[key];
        if (Object.hasOwn(device.parameterValues, key)) {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return null;
            }
            parameterValues[key] = value;
        } else {
            parameterValues[key] = null;
        }
    }
    return {
        kind: 'device',
        ...shared,
        deviceType: device.type,
        state: { deviceState: device.deviceState ? structuredClone(device.deviceState) : null, parameterValues },
    };
}

function parameterSourceMatches(
    owners: readonly Owner[],
    action: Extract<AppAction, { type: 'setDeviceParameter' }>
): boolean {
    const target = uniqueDevice(owners, action.payload.deviceId);
    if (!target) {
        return false;
    }
    const { owner, device } = target;
    const p = action.payload;
    const present = Object.hasOwn(device.parameterValues, p.paramId);
    return (
        (p.expectedTrackId === undefined || owner.id === p.expectedTrackId) &&
        (p.expectedDeviceType === undefined || device.type === p.expectedDeviceType) &&
        (p.expectedDeviceIds === undefined ||
            (p.expectedDeviceIds.length === owner.devices.length &&
                p.expectedDeviceIds.every((id, index) => owner.devices[index]?.id === id))) &&
        (p.expectedTrackFrozen === undefined || owner.frozen === p.expectedTrackFrozen) &&
        (p.expectedValuePresent === undefined || present === p.expectedValuePresent) &&
        (p.expectedValue === undefined || (present && device.parameterValues[p.paramId] === p.expectedValue))
    );
}

/** Plan from an explicit initial snapshot, never from an already-staged midpoint. */
export function planDevicePatchWrite(input: PlanInput): PlannedDeviceWrite {
    if (
        !Number.isInteger(input.actionIndex) ||
        input.actionIndex < 0 ||
        input.actionIndex > input.steps.length ||
        new Set(input.parameterIds).size !== input.parameterIds.length ||
        new Set(input.source.map((owner) => owner.id)).size !== input.source.length
    ) {
        return { status: 'conflict', reason: 'Invalid planned device source or action index' };
    }
    let owners: Owner[] = input.source.map((owner) => ({
        id: owner.id,
        frozen: owner.frozen,
        devices: projectDeviceSnapshots(owner.devices),
    }));
    const source = presence(owners, input);
    if (!source) {
        return { status: 'conflict', reason: 'Planned device ownership is ambiguous' };
    }
    let prefix: PlannedDevicePresence | null = null;
    for (const [index, step] of input.steps.entries()) {
        if (index === input.actionIndex) {
            prefix = presence(owners, input);
        }
        if (step.kind === 'patch') {
            const target = uniqueDevice(owners, step.deviceId);
            if (
                !target ||
                target.owner.id !== step.trackId ||
                (target.owner.frozen ?? false) !== step.expectedTrackFrozen ||
                target.owner.frozen === true ||
                target.owner.devices.length !== step.expectedDeviceIds.length ||
                step.expectedDeviceIds.some((id, i) => target.owner.devices[i]?.id !== id)
            ) {
                return { status: 'conflict', reason: 'Captured patch owner changed within the plan' };
            }
            const device = projectCapturedDevicePatch(target.device, step.expected, step.after);
            if (!device) {
                return { status: 'conflict', reason: 'Captured patch source changed within the plan' };
            }
            target.owner.devices = target.owner.devices.map((candidate) => {
                if (candidate.id === step.deviceId) {
                    return device;
                }
                return candidate;
            });
            continue;
        }
        if (step.kind === 'restore-owner') {
            if (owners.some((owner) => owner.id === step.source.id)) {
                return { status: 'conflict', reason: 'Restored track is already present' };
            }
            owners.push({
                id: step.source.id,
                frozen: step.source.frozen,
                devices: projectDeviceSnapshots(step.source.devices),
            });
            continue;
        }
        const action = step.action;
        if (action.type === 'setFermenterPatch') {
            return { status: 'unsupported', reason: 'A current-format captured patch adapter is required' };
        }
        if (action.type === 'removeTrack') {
            owners = owners.filter((owner) => owner.id !== action.payload.trackId);
            continue;
        }
        if (action.type === 'restoreTrack') {
            return {
                status: 'unsupported',
                reason: 'The opaque track snapshot needs an owning planned-source adapter',
            };
        }
        if (action.type === 'addTrack' || action.type === 'createBus') {
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
            const track =
                action.type === 'addTrack'
                    ? createTrack({
                          id,
                          kind: action.payload.kind,
                          name: action.payload.name ?? id,
                          color: '#000000',
                          initialAlternativeId: `planned-${id}`,
                          initialDeviceId: action.payload.initialDeviceId,
                          withoutDefaultDevice: action.payload.withoutDefaultDevice,
                      })
                    : createTrack({
                          id,
                          kind: 'bus',
                          name: action.payload.name,
                          color: '#000000',
                          initialAlternativeId: `planned-${id}`,
                      });
            owners.push({ id, frozen: track.frozen, devices: track.devices });
            continue;
        }
        if (action.type === 'setDeviceParameter' && !parameterSourceMatches(owners, action)) {
            return { status: 'conflict', reason: 'Planned parameter source changed' };
        }
        for (const owner of owners) {
            const devices = projectDeviceChainAction(owner.id, owner.devices, action, input.plugins);
            if (devices) {
                owner.devices = devices;
            }
        }
    }
    const terminal = presence(owners, input);
    if (input.actionIndex === input.steps.length) {
        prefix = terminal;
    }
    if (!prefix || !terminal) {
        return { status: 'conflict', reason: 'Planned device owner became ambiguous' };
    }
    return { status: 'ready', source, prefix, terminal };
}
