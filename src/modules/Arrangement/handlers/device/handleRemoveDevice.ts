import { createHandler } from '#/utils/createHandler';
import { type AppAction, type DeviceOwnerIncarnation, type HandlerValidationContext } from '#/utils/handlerContract';

import { captureDeviceHistoryCommitValidation } from '../../useCases/device/captureDeviceHistoryCommitValidation';
import { getDevicePatchOwnerIncarnation } from '../../useCases/device/getDevicePatchOwnerIncarnation';
import { prepareRemoveDevice } from '../../useCases/device/prepareRemoveDevice';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';
import { recordDiscardedDevicePluginStates } from '../track/discardedPluginStateCarry';

import { findPlannedDeviceOwner } from './findPlannedDeviceOwner';

type RemoveDeviceAction = Extract<AppAction, { type: 'removeDevice' }>;
type RestoreDeviceAction = Extract<AppAction, { type: 'restoreDevice' }>;
type RemovalCapture = {
    trackId: string;
    owner: DeviceOwnerIncarnation;
    recordedRedo?: NonNullable<HandlerValidationContext['recordedRedo']>;
};
const pendingRemovals = new WeakMap<RemoveDeviceAction, RemovalCapture>();

function commitValidationForRemoval(action: RemoveDeviceAction, context?: HandlerValidationContext) {
    const capture = pendingRemovals.get(action);
    pendingRemovals.delete(action);
    if (!capture || context?.executionMode === 'isolated-preview') {
        return undefined;
    }
    if (capture.recordedRedo && !capture.recordedRedo.isCurrent()) {
        return null;
    }
    return captureDeviceHistoryCommitValidation({
        kind: 'remove',
        target: { trackId: capture.trackId, deviceId: action.payload.deviceId },
        removed: capture.owner,
    });
}

/** A redo replays this removal with the first run's device snapshot. */
function recordRemovedPluginState(deviceId: string, undoEntryId: string | undefined): void {
    if (undoEntryId === undefined) {
        return;
    }
    const devices = (getTrackStoreState()?.tracks ?? []).flatMap((track) => track.devices);
    recordDiscardedDevicePluginStates(
        undoEntryId,
        devices.filter((device) => device.id === deviceId)
    );
}

function liveOwnerFreezeMatches(deviceId: string, expectedFrozen: boolean | undefined): boolean {
    if (expectedFrozen === undefined) {
        return true;
    }
    const owners = (getTrackStoreState()?.tracks ?? []).filter((track) =>
        track.devices.some((device) => device.id === deviceId)
    );
    const owner = owners.length === 1 ? owners[0] : undefined;
    return owner !== undefined && owner.frozen === expectedFrozen;
}

function plannedOwnerFreezeMatches(
    deviceId: string,
    expectedFrozen: boolean | undefined,
    context: HandlerValidationContext
): boolean {
    if (expectedFrozen === undefined) {
        return true;
    }
    const owner = findPlannedDeviceOwner(deviceId, context);
    return owner !== undefined && owner.frozen === expectedFrozen;
}

function findRemovalTarget(deviceId: string) {
    const state = getTrackStoreState();
    const owners = (state?.tracks ?? []).flatMap((track) => {
        const deviceIndex = track.devices.findIndex((device) => device.id === deviceId);
        if (deviceIndex < 0) {
            return [];
        }
        return [{ track, deviceIndex, device: track.devices[deviceIndex]! }];
    });
    return owners.length === 1 ? owners[0] : undefined;
}

type RemovalTarget = NonNullable<ReturnType<typeof findRemovalTarget>>;

function readInitialRemovalOwner(
    target: RemovalTarget,
    recordedRedo: HandlerValidationContext['recordedRedo'],
    context?: HandlerValidationContext
) {
    if (
        recordedRedo ||
        context?.executionMode === 'isolated-preview' ||
        (context?.actions.length ?? 1) !== 1 ||
        target.device.type !== 'grinder'
    ) {
        return null;
    }
    return getDevicePatchOwnerIncarnation({ trackId: target.track.id, deviceId: target.device.id });
}

function describeRestoreDevice(
    target: RemovalTarget,
    deviceId: string,
    removedOwner: DeviceOwnerIncarnation | null
): RestoreDeviceAction {
    const payload: RestoreDeviceAction['payload'] = {
        trackId: target.track.id,
        deviceSnapshot: structuredClone(target.device),
        deviceIndex: target.deviceIndex,
    };
    if (removedOwner) {
        payload.removedOwner = removedOwner;
    }
    payload.expectedDeviceIds = target.track.devices
        .filter((device) => device.id !== deviceId)
        .map((device) => device.id);
    return { type: 'restoreDevice', payload };
}

export const handleRemoveDevice = createHandler<'removeDevice'>({
    validateSessionEntry: ({ action, inverseAction, redoAction }) =>
        action.type === 'removeDevice' &&
        inverseAction?.type === 'restoreDevice' &&
        inverseAction.payload.deviceSnapshot.id === action.payload.deviceId &&
        inverseAction.payload.deviceSnapshot.type === 'grinder' &&
        inverseAction.payload.expectedDeviceIds !== undefined &&
        inverseAction.payload.removedOwner !== undefined &&
        inverseAction.payload.removedOwner.trackObjectId.length > 0 &&
        inverseAction.payload.removedOwner.deviceObjectId.length > 0 &&
        (action.payload.expectedTrackId === undefined ||
            action.payload.expectedTrackId === inverseAction.payload.trackId) &&
        redoAction === undefined,
    canReapplyAfterDivergence: (action) =>
        action.payload.expectedTrackId !== undefined && action.payload.expectedDeviceIds !== undefined,
    validate: (action, context) => {
        if (!plannedOwnerFreezeMatches(action.payload.deviceId, action.payload.expectedFrozen, context)) {
            return false;
        }
        if (!action.payload.expectedTrackId && !action.payload.expectedDeviceIds) {
            return true;
        }
        if (!action.payload.expectedTrackId || !action.payload.expectedDeviceIds) {
            return false;
        }
        const foreignOwnerExists = (getTrackStoreState()?.tracks ?? []).some(
            (track) =>
                track.id !== action.payload.expectedTrackId &&
                track.devices.some((device) => device.id === action.payload.deviceId)
        );
        const owner = getPlannedTrackState(context, action.payload.expectedTrackId);
        const currentDeviceIds = owner?.devices.map((device) => device.id);
        return (
            !foreignOwnerExists &&
            owner !== null &&
            owner.devices.some((device) => device.id === action.payload.deviceId) &&
            action.payload.expectedDeviceIds.length === currentDeviceIds?.length &&
            action.payload.expectedDeviceIds.every((deviceId, index) => currentDeviceIds[index] === deviceId)
        );
    },
    execute: (alpha, context) => {
        if (!liveOwnerFreezeMatches(alpha.payload.deviceId, alpha.payload.expectedFrozen)) {
            return { status: 'conflict' };
        }
        if (alpha.payload.expectedTrackId || alpha.payload.expectedDeviceIds) {
            const owners = (getTrackStoreState()?.tracks ?? []).filter((track) =>
                track.devices.some((device) => device.id === alpha.payload.deviceId)
            );
            const owner = owners.length === 1 ? owners[0] : undefined;
            const currentDeviceIds = owner?.devices.map((device) => device.id);
            if (
                !owner ||
                owner.id !== alpha.payload.expectedTrackId ||
                !alpha.payload.expectedDeviceIds ||
                alpha.payload.expectedDeviceIds.length !== currentDeviceIds?.length ||
                alpha.payload.expectedDeviceIds.some((deviceId, index) => currentDeviceIds[index] !== deviceId)
            ) {
                return { status: 'conflict' };
            }
        }
        const commitValidation = commitValidationForRemoval(alpha, context);
        if (commitValidation === null) {
            return { status: 'conflict', reason: 'The recorded Grinder removal owner changed.' };
        }
        recordRemovedPluginState(alpha.payload.deviceId, context?.undoEntryId);
        const result = prepareRemoveDevice(alpha.payload.deviceId, context);
        if (result === 'conflict') {
            return { status: 'conflict' };
        }
        if (result === 'missing') {
            return { status: 'no-write' };
        }
        if (result === 'written') {
            return { status: 'written', commitValidation };
        }
        return {
            status: result.outcome,
            commitValidation,
            afterCommit: result.afterCommit,
            afterAmbiguousCommit: result.afterAmbiguousCommit,
        };
    },
    describe: (action, context) => {
        pendingRemovals.delete(action);
        const recordedRedo = context?.recordedRedo;
        const inverse = recordedRedo?.inverseAction;
        if (recordedRedo && inverse?.type === 'restoreDevice' && inverse.payload.removedOwner) {
            pendingRemovals.set(action, {
                trackId: inverse.payload.trackId,
                owner: inverse.payload.removedOwner,
                recordedRedo,
            });
        }
        const target = findRemovalTarget(action.payload.deviceId);
        if (!target) {
            return { label: 'Remove device', inverseAction: null };
        }
        const removedOwner = readInitialRemovalOwner(target, recordedRedo, context);
        if (removedOwner) {
            pendingRemovals.set(action, { trackId: target.track.id, owner: removedOwner });
        }
        return {
            label: `Remove ${target.device.name}`,
            inverseAction: describeRestoreDevice(target, action.payload.deviceId, removedOwner),
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
