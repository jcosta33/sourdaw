import { createHandler } from '#/utils/createHandler';

import { restoreDevice } from '../../useCases/device/restoreDevice';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleRestoreDevice = createHandler<'restoreDevice'>({
    execute: (action) => {
        const currentTrack = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        const currentDeviceIds = currentTrack?.devices.map((device) => device.id);
        const batchRestoreDevices = action.payload.batchRestoreDevices ?? [];
        const siblingDeviceIds = new Set(
            batchRestoreDevices
                .filter((candidate) => candidate.trackId === action.payload.trackId)
                .map((candidate) => candidate.deviceId)
        );
        if (action.payload.expectedDeviceIds) {
            const expectedCurrentDeviceIds = action.payload.expectedDeviceIds.filter(
                (deviceId) => !siblingDeviceIds.has(deviceId) || currentDeviceIds?.includes(deviceId)
            );
            if (
                !currentDeviceIds ||
                currentDeviceIds.length !== expectedCurrentDeviceIds.length ||
                expectedCurrentDeviceIds.some((deviceId, index) => currentDeviceIds[index] !== deviceId)
            ) {
                return { status: 'conflict' };
            }
        }
        const missingEarlierSiblingCount = batchRestoreDevices.filter(
            (candidate) =>
                candidate.trackId === action.payload.trackId &&
                candidate.deviceId !== action.payload.deviceSnapshot.id &&
                candidate.deviceIndex < action.payload.deviceIndex &&
                !currentDeviceIds?.includes(candidate.deviceId)
        ).length;
        const insertionIndex = action.payload.deviceIndex - missingEarlierSiblingCount;
        const outcome = restoreDevice(
            {
                trackId: action.payload.trackId,
                deviceSnapshot: action.payload.deviceSnapshot,
                deviceIndex: insertionIndex,
            },
            { deferRuntimeEffects: true }
        );
        if (outcome === 'conflict') {
            return { status: 'conflict' };
        }
        return {
            status: outcome.outcome,
            afterCommit: outcome.afterCommit,
            afterAmbiguousCommit: outcome.afterAmbiguousCommit,
        };
    },
    describe: () => ({ label: 'Restore device' }),
    requiresAbortCompensation: false,
    undoable: false,
});
