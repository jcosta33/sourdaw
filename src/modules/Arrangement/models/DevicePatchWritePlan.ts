import { projectCapturedDevicePatch, projectCapturedDevicePatchWithMetadata } from './CapturedDevicePatchProjection';
import { type PluginDescriptor } from './DeviceParameterTypes';
import { type DevicePatchState } from './DevicePatchState';
import { projectDeviceSnapshots } from './DeviceSnapshotProjection';
import {
    type PlannedDeviceOwnerSource,
    type PlannedDevicePresence,
    type PlannedDeviceWrite,
    type PlannedDeviceWriteStep,
} from './PlannedDeviceWrite';
import { type Owner, type PlanFailure, uniqueDevice } from './PlannedOwnerProjection';
import { projectCommandOwners } from './PlannedOwnerProjectorByActionType';
import { type Device } from './Track';

type PlanInput = {
    source: readonly PlannedDeviceOwnerSource[];
    trackId: string;
    deviceId: string;
    parameterIds: readonly string[];
    steps: readonly PlannedDeviceWriteStep[];
    actionIndex: number;
    plugins: readonly PluginDescriptor[];
};

function presence(owners: readonly Owner[], input: PlanInput): PlannedDevicePresence | null {
    const ownersWithId = owners.filter((owner) => owner.id === input.trackId);
    const occurrences = owners.flatMap((owner) => owner.devices.filter((device) => device.id === input.deviceId));
    if (ownersWithId.length > 1 || occurrences.length > 1) {
        return null;
    }
    const owner = ownersWithId[0];
    if (!owner) {
        if (occurrences.length === 0) {
            return { kind: 'absent-track', trackId: input.trackId, deviceId: input.deviceId };
        }
        return null;
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

function projectPlannedPatch(device: Device, step: Extract<PlannedDeviceWriteStep, { kind: 'patch' }>): Device | null {
    if (step.preservedMetadata) {
        return projectCapturedDevicePatchWithMetadata(device, step.expected, step.after, step.preservedMetadata);
    }
    return projectCapturedDevicePatch(device, step.expected, step.after);
}

function projectCapturedStep(
    owners: Owner[],
    step: Extract<PlannedDeviceWriteStep, { kind: 'patch' }>
): PlanFailure | null {
    const target = uniqueDevice(owners, step.deviceId);
    if (
        !target ||
        target.owner.id !== step.trackId ||
        (step.expectedDeviceType !== undefined && target.device.type !== step.expectedDeviceType) ||
        (target.owner.frozen ?? false) !== step.expectedTrackFrozen ||
        target.owner.frozen === true ||
        target.owner.devices.length !== step.expectedDeviceIds.length ||
        step.expectedDeviceIds.some((id, i) => target.owner.devices[i]?.id !== id)
    ) {
        return { status: 'conflict', reason: 'Captured patch owner changed within the plan' };
    }
    const device = projectPlannedPatch(target.device, step);
    if (!device) {
        return { status: 'conflict', reason: 'Captured patch source changed within the plan' };
    }
    target.owner.devices = target.owner.devices.map((candidate) => {
        if (candidate.id === step.deviceId) {
            return device;
        }
        return candidate;
    });
    return null;
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
            const failure = projectCapturedStep(owners, step);
            if (failure) {
                return failure;
            }
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
        const projection = projectCommandOwners(owners, step.action, input.plugins);
        if (projection.status !== 'projected') {
            return projection;
        }
        owners = projection.owners;
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
