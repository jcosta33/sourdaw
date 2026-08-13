import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { restoreDevice } from '../../useCases/device/restoreDevice';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';

type RestoreDeviceAction = Extract<AppAction, { type: 'restoreDevice' }>;

function restoreDeviceGuardMatches(action: RestoreDeviceAction, context?: HandlerValidationContext): boolean {
    const currentTrack = context
        ? getPlannedTrackState(context, action.payload.trackId)
        : getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
    const currentDeviceIds = currentTrack?.devices.map((device) => device.id);
    const siblingDeviceIds = new Set(
        (action.payload.batchRestoreDevices ?? [])
            .filter((candidate) => candidate.trackId === action.payload.trackId)
            .map((candidate) => candidate.deviceId)
    );
    if (!action.payload.expectedDeviceIds) {
        return currentTrack !== undefined;
    }
    const expectedCurrentDeviceIds = action.payload.expectedDeviceIds.filter(
        (deviceId) => !siblingDeviceIds.has(deviceId) || currentDeviceIds?.includes(deviceId)
    );
    return (
        currentDeviceIds !== undefined &&
        currentDeviceIds.length === expectedCurrentDeviceIds.length &&
        expectedCurrentDeviceIds.every((deviceId, index) => currentDeviceIds[index] === deviceId)
    );
}

export const handleRestoreDevice = createHandler<'restoreDevice'>({
    validate: restoreDeviceGuardMatches,
    execute: (action) => {
        const currentTrack = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        const currentDeviceIds = currentTrack?.devices.map((device) => device.id);
        const batchRestoreDevices = action.payload.batchRestoreDevices ?? [];
        if (!restoreDeviceGuardMatches(action)) {
            return { status: 'conflict' };
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
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
