import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { abortAddedDeviceRuntime } from '../../useCases/device/abortAddedDeviceRuntime';
import { addDevice } from '../../useCases/device/addDevice';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type AddDeviceAction = Extract<AppAction, { type: 'addDevice' }>;
type DeviceIndexResolution = { status: 'resolved'; deviceIndex?: number } | { status: 'conflict' };

function ensureDeviceId(action: AddDeviceAction): string {
    if (action.payload.deviceId) {
        return action.payload.deviceId;
    }
    const deviceId = `device-${crypto.randomUUID().slice(0, 8)}`;
    action.payload.deviceId = deviceId;
    return deviceId;
}

function resolveDeviceIndex(action: AddDeviceAction, context?: HandlerValidationContext): DeviceIndexResolution {
    if (
        !action.payload.expectedDeviceIds &&
        !action.payload.afterDeviceId &&
        action.payload.expectedFrozen === undefined
    ) {
        return { status: 'resolved' };
    }
    const track = context
        ? getPlannedTrackState(context, action.payload.trackId)
        : getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
    if (!track || (action.payload.expectedFrozen !== undefined && track.frozen !== action.payload.expectedFrozen)) {
        return { status: 'conflict' };
    }
    const currentDeviceIds = track.devices.map((device) => device.id);
    if (
        action.payload.expectedDeviceIds &&
        (action.payload.expectedDeviceIds.length !== currentDeviceIds.length ||
            action.payload.expectedDeviceIds.some((deviceId, index) => currentDeviceIds[index] !== deviceId))
    ) {
        return { status: 'conflict' };
    }
    let deviceIndex = track.devices.length;
    if (action.payload.afterDeviceId) {
        const matchingAnchorIndices = track.devices.flatMap((device, index) =>
            device.id === action.payload.afterDeviceId ? [index] : []
        );
        if (matchingAnchorIndices.length !== 1) {
            return { status: 'conflict' };
        }
        deviceIndex = matchingAnchorIndices[0]! + 1;
    }
    return { status: 'resolved', deviceIndex };
}

export const handleAddDevice = createHandler<'addDevice'>({
    validate: (action, context) => resolveDeviceIndex(action, context).status === 'resolved',
    execute: (action, context) => {
        const resolution = resolveDeviceIndex(action);
        if (resolution.status === 'conflict') {
            return { status: 'conflict' };
        }
        const deviceId = ensureDeviceId(action);
        let addedDevice;
        if (context?.executionMode === 'isolated-preview') {
            addedDevice = addDevice(
                action.payload.trackId,
                action.payload.deviceType,
                undefined,
                deviceId,
                resolution.deviceIndex,
                undefined,
                { projectOnly: true }
            );
        } else if (resolution.deviceIndex !== undefined) {
            addedDevice = addDevice(
                action.payload.trackId,
                action.payload.deviceType,
                undefined,
                deviceId,
                resolution.deviceIndex
            );
        } else {
            addedDevice = addDevice(action.payload.trackId, action.payload.deviceType, undefined, deviceId);
        }
        return toHandlerExecutionResult(addedDevice !== null);
    },
    describe: (action) => {
        const deviceId = ensureDeviceId(action);
        const inversePayload: {
            deviceId: string;
            expectedTrackId?: string;
            expectedDeviceIds?: readonly string[];
        } = { deviceId };
        if (action.payload.expectedDeviceIds) {
            const expectedDeviceIds = [...action.payload.expectedDeviceIds];
            let deviceIndex = expectedDeviceIds.length;
            if (action.payload.afterDeviceId) {
                const anchorIndex = expectedDeviceIds.indexOf(action.payload.afterDeviceId);
                if (anchorIndex >= 0) {
                    deviceIndex = anchorIndex + 1;
                }
            }
            expectedDeviceIds.splice(deviceIndex, 0, deviceId);
            inversePayload.expectedTrackId = action.payload.trackId;
            inversePayload.expectedDeviceIds = expectedDeviceIds;
        } else {
            // Without expecteds, removeDevice's canReapplyAfterDivergence
            // returns false and any atomic batch containing this action is
            // rejected ("Action compensation is not guarded inside an atomic
            // batch: addDevice"). A bare add appends, so the post-add chain is
            // the current device ids with this id appended — the same snapshot
            // the expecteds branch above builds for pre-declared chains.
            const currentDeviceIds =
                getTrackStoreState()
                    ?.tracks.find((track) => track.id === action.payload.trackId)
                    ?.devices.map((device) => device.id) ?? [];
            inversePayload.expectedTrackId = action.payload.trackId;
            inversePayload.expectedDeviceIds = [...currentDeviceIds, deviceId];
        }
        return {
            label: `Add ${action.payload.deviceType}`,
            inverseAction: { type: 'removeDevice', payload: inversePayload },
        };
    },
    prepareAbort: (action) => {
        const deviceId = ensureDeviceId(action);
        return () => {
            abortAddedDeviceRuntime({ trackId: action.payload.trackId, deviceId });
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
