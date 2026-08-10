import { createHandler } from '#/utils/createHandler';

import { abortAddedDeviceRuntime } from '../../useCases/device/abortAddedDeviceRuntime';
import { addDevice } from '../../useCases/device/addDevice';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type AddDeviceAction = { payload: { deviceId?: string } };

function ensureDeviceId(action: AddDeviceAction): string {
    if (action.payload.deviceId) {
        return action.payload.deviceId;
    }
    const deviceId = `device-${crypto.randomUUID().slice(0, 8)}`;
    action.payload.deviceId = deviceId;
    return deviceId;
}

export const handleAddDevice = createHandler<'addDevice'>({
    execute: (action) => {
        let deviceIndex: number | undefined;
        if (
            action.payload.expectedDeviceIds ||
            action.payload.afterDeviceId ||
            action.payload.expectedFrozen !== undefined
        ) {
            const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
            if (!track) {
                return { status: 'conflict' };
            }
            if (action.payload.expectedFrozen !== undefined && track.frozen !== action.payload.expectedFrozen) {
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
            deviceIndex = track.devices.length;
            if (action.payload.afterDeviceId) {
                const matchingAnchorIndices = track.devices.flatMap((device, index) =>
                    device.id === action.payload.afterDeviceId ? [index] : []
                );
                if (matchingAnchorIndices.length !== 1) {
                    return { status: 'conflict' };
                }
                deviceIndex = matchingAnchorIndices[0]! + 1;
            }
        }
        const deviceId = ensureDeviceId(action);
        const addDeviceArguments: [string, string, undefined, string, number?] = [
            action.payload.trackId,
            action.payload.deviceType,
            undefined,
            deviceId,
        ];
        if (deviceIndex !== undefined) {
            addDeviceArguments[4] = deviceIndex;
        }
        const addedDevice = addDevice(...addDeviceArguments);
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
    requiresAbortCompensation: true,
    undoable: true,
});
