import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { type ProjectContextDevice } from '../../models/ProjectContext';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'addDevice' }>;

export function materializeAddedDevice(action: Action, state: MaterializationState): MaterializationStep {
    const { context, tracksById, frozenByTrack, reservedDeviceIds, deviceIdsByTrack } = state;
    const expectedFrozen = frozenByTrack.get(action.payload.trackId);
    if (expectedFrozen === undefined) {
        return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
    }
    if (expectedFrozen) {
        return { status: 'rejected', reason: `Track is frozen: ${action.payload.trackId}` };
    }
    const expectedDeviceIds = deviceIdsByTrack.get(action.payload.trackId);
    if (!expectedDeviceIds) {
        return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
    }
    let deviceId = action.payload.deviceId;
    if (deviceId) {
        if (reservedDeviceIds.has(deviceId)) {
            return { status: 'rejected', reason: `Device identity is already in use: ${deviceId}` };
        }
    } else {
        const baseDeviceId = `device-ai-${action.payload.trackId}-${action.payload.deviceType}`;
        deviceId = baseDeviceId;
        let suffix = 2;
        while (reservedDeviceIds.has(deviceId)) {
            deviceId = `${baseDeviceId}-${String(suffix)}`;
            suffix += 1;
        }
    }
    reservedDeviceIds.add(deviceId);
    const nextDeviceIds = [...expectedDeviceIds];
    let insertionIndex = nextDeviceIds.length;
    if (action.payload.afterDeviceId) {
        const anchorIndex = nextDeviceIds.indexOf(action.payload.afterDeviceId);
        if (anchorIndex < 0) {
            return {
                status: 'rejected',
                reason: `Device is unavailable: ${action.payload.afterDeviceId}`,
            };
        }
        insertionIndex = anchorIndex + 1;
    }
    nextDeviceIds.splice(insertionIndex, 0, deviceId);
    deviceIdsByTrack.set(action.payload.trackId, nextDeviceIds);
    const projectedTrack = tracksById.get(action.payload.trackId);
    if (!projectedTrack) {
        return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
    }
    const projectedDevices = [...projectedTrack.devices];
    const descriptor = context.availableDeviceTypes?.find((candidate) => candidate.id === action.payload.deviceType);
    const projectedDevice: ProjectContextDevice = {
        id: deviceId,
        type: action.payload.deviceType,
        bypassed: false,
        parameters: structuredClone(descriptor?.parameters ?? []),
    };
    if (descriptor) {
        projectedDevice.name = descriptor.name;
    }
    projectedDevices.splice(insertionIndex, 0, projectedDevice);
    tracksById.set(action.payload.trackId, {
        ...projectedTrack,
        deviceCount: projectedDevices.length,
        devices: projectedDevices,
    });
    return {
        status: 'accepted',
        actions: [
            {
                type: 'addDevice',
                payload: {
                    ...action.payload,
                    deviceId,
                    expectedDeviceIds,
                    expectedFrozen,
                },
            },
        ],
    };
}
