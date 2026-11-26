import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { captureDeviceHistoryCommitValidation } from '../../useCases/device/captureDeviceHistoryCommitValidation';
import { restoreDevice } from '../../useCases/device/restoreDevice';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';
import {
    forgettingDiscardedPluginStates,
    overlayDiscardedDevicePluginStates,
} from '../track/discardedPluginStateCarry';

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

function captureRestoreValidation(action: RestoreDeviceAction, context?: HandlerValidationContext) {
    const rebind = context?.rebindDeviceHistory;
    const { removedOwner, trackId, deviceSnapshot } = action.payload;
    if (!rebind || !removedOwner || context.executionMode === 'isolated-preview') {
        return undefined;
    }
    const target = { trackId, deviceId: deviceSnapshot.id };
    return captureDeviceHistoryCommitValidation({ kind: 'restore', target, removed: removedOwner, rebind });
}

export const handleRestoreDevice = createHandler<'restoreDevice'>({
    rebindDeviceOwner: (action, owner) => {
        const { payload } = action;
        if (
            payload.trackId !== owner.trackId ||
            payload.deviceSnapshot.id !== owner.deviceId ||
            !valuesEqual(payload.removedOwner, owner.previous)
        ) {
            return action;
        }
        return { ...action, payload: { ...payload, removedOwner: owner.current } };
    },
    canReapplyAfterDivergence: (action) => action.payload.expectedDeviceIds !== undefined,
    // The removal this undoes recorded the plugin state a save captured after the snapshot was taken.
    materializeCommandArguments: (action, context) => {
        if (context?.undoEntryId === undefined) {
            return;
        }
        const [deviceSnapshot] = overlayDiscardedDevicePluginStates(context.undoEntryId, [
            action.payload.deviceSnapshot,
        ]);
        if (deviceSnapshot) {
            action.payload.deviceSnapshot = deviceSnapshot;
        }
    },
    validate: restoreDeviceGuardMatches,
    execute: (action, context) => {
        const currentTrack = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        const currentDeviceIds = currentTrack?.devices.map((device) => device.id);
        const batchRestoreDevices = action.payload.batchRestoreDevices ?? [];
        if (!restoreDeviceGuardMatches(action)) {
            return { status: 'conflict' };
        }
        const commitValidation = captureRestoreValidation(action, context);
        if (commitValidation === null) {
            return { status: 'conflict', reason: 'The recorded Grinder restoration owner changed.' };
        }
        const missingEarlierSiblingCount = batchRestoreDevices.filter(
            (candidate) =>
                candidate.trackId === action.payload.trackId &&
                candidate.deviceId !== action.payload.deviceSnapshot.id &&
                candidate.deviceIndex < action.payload.deviceIndex &&
                !currentDeviceIds?.includes(candidate.deviceId)
        ).length;
        const insertionIndex = action.payload.deviceIndex - missingEarlierSiblingCount;
        const restoreOptions: Parameters<typeof restoreDevice>[1] = { deferRuntimeEffects: true };
        if (context) {
            restoreOptions.batchContext = context;
        }
        const outcome = restoreDevice(
            {
                trackId: action.payload.trackId,
                deviceSnapshot: action.payload.deviceSnapshot,
                deviceIndex: insertionIndex,
            },
            restoreOptions
        );
        if (outcome === 'conflict') {
            return { status: 'conflict' };
        }
        return {
            status: outcome.outcome,
            commitValidation,
            afterCommit: forgettingDiscardedPluginStates(context?.undoEntryId, outcome.afterCommit),
            afterAmbiguousCommit: outcome.afterAmbiguousCommit,
        };
    },
    describe: () => ({ label: 'Restore device' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
