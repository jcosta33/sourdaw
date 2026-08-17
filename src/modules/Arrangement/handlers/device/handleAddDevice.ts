import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { type Device } from '../../stores/trackStore';
import { addDevice } from '../../useCases/device/addDevice';
import { applyDeviceChainRuntimeDelta } from '../../useCases/device/applyDeviceChainRuntimeDelta';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type AddDeviceAction = Extract<AppAction, { type: 'addDevice' }>;
type DeviceIndexResolution = { status: 'resolved'; deviceIndex?: number } | { status: 'conflict' };
type RuntimeDeviceDeltaResult = ReturnType<typeof applyDeviceChainRuntimeDelta>;
type RuntimeDeviceDeltaFailure = Exclude<
    RuntimeDeviceDeltaResult,
    Readonly<{ acceptance: 'accepted'; application: 'applied' }>
>;

class RuntimeDeviceDeltaPostCommitError extends Error {
    public readonly outcome: RuntimeDeviceDeltaFailure;
    public readonly remediation: 'retry' | 'repair';

    constructor(outcome: RuntimeDeviceDeltaFailure) {
        const remediation = outcome.acceptance === 'rejected' ? 'retry' : 'repair';
        super(
            outcome.acceptance === 'rejected'
                ? `Device runtime delta was rejected after project commit and requires ${remediation}: ${outcome.reason}`
                : `Device runtime delta requires ${remediation} after project commit: ${outcome.reason}`
        );
        this.name = 'RuntimeDeviceDeltaPostCommitError';
        this.outcome = outcome;
        this.remediation = remediation;
    }
}

function getRuntimeDeviceDeltaPostCommitFailure(
    result: RuntimeDeviceDeltaResult
): RuntimeDeviceDeltaPostCommitError | undefined {
    if (result.acceptance === 'accepted' && result.application === 'applied') {
        return undefined;
    }
    return new RuntimeDeviceDeltaPostCommitError(result);
}

function ensureDeviceId(action: AddDeviceAction): string {
    if (action.payload.deviceId) {
        return action.payload.deviceId;
    }
    const deviceId = `device-${crypto.randomUUID().slice(0, 8)}`;
    action.payload.deviceId = deviceId;
    return deviceId;
}

// Placeholder chains for bare adds (no pre-declared expecteds), keyed by
// action; execute fills them with the actual post-add chain so the shared
// inverse payload carried into history matches what undo will validate
// against regardless of chain mutations by earlier batch actions or
// afterDeviceId mid-chain insertion.
const pendingBareChains = new WeakMap<object, string[]>();

function finalizeBareChain(action: AddDeviceAction): void {
    const expectedDeviceIds = pendingBareChains.get(action);
    if (!expectedDeviceIds) {
        return;
    }
    pendingBareChains.delete(action);
    const chain =
        getTrackStoreState()
            ?.tracks.find((track) => track.id === action.payload.trackId)
            ?.devices.map((device) => device.id) ?? [];
    expectedDeviceIds.splice(0, expectedDeviceIds.length, ...chain);
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
        const beforeTrack = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId);
        const before = beforeTrack ? structuredClone(beforeTrack) : null;
        let addedDevice: Device | null;
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
                resolution.deviceIndex,
                undefined,
                { projectOnly: true }
            );
        } else {
            addedDevice = addDevice(
                action.payload.trackId,
                action.payload.deviceType,
                undefined,
                deviceId,
                undefined,
                undefined,
                { projectOnly: true }
            );
        }
        if (addedDevice !== null) {
            finalizeBareChain(action);
        }
        if (addedDevice === null || context?.executionMode === 'isolated-preview' || !before) {
            return toHandlerExecutionResult(addedDevice !== null);
        }
        const committedDevice = addedDevice;
        const committedBefore = before;
        const insertionIndex = resolution.deviceIndex ?? committedBefore.devices.length;
        const after = {
            ...committedBefore,
            devices: [
                ...committedBefore.devices.slice(0, insertionIndex),
                committedDevice,
                ...committedBefore.devices.slice(insertionIndex),
            ],
        };
        let postCommitFailure: RuntimeDeviceDeltaPostCommitError | undefined;
        function applyRuntimeEffect(): void {
            if (postCommitFailure) {
                throw postCommitFailure;
            }
            const result = applyDeviceChainRuntimeDelta({ before: committedBefore, after, operation: 'add-device' });
            const runtimeFailure = getRuntimeDeviceDeltaPostCommitFailure(result);
            if (runtimeFailure) {
                postCommitFailure = runtimeFailure;
                throw postCommitFailure;
            }
            for (const [parameterId, value] of Object.entries(committedDevice.parameterValues)) {
                updateDeviceParam(after.id, committedDevice.id, parameterId, value);
            }
        }
        return {
            status: 'written' as const,
            afterCommit: applyRuntimeEffect,
            afterAmbiguousCommit: applyRuntimeEffect,
        };
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
            // batch: addDevice"). A describe-time chain snapshot would be
            // stale by undo time — earlier batch actions may have mutated the
            // chain, and an afterDeviceId-only payload inserts mid-chain — so
            // the placeholder is finalized from the actual post-add chain in
            // execute (the array is shared by reference with the inverse).
            const expectedDeviceIds: string[] = [];
            pendingBareChains.set(action, expectedDeviceIds);
            inversePayload.expectedTrackId = action.payload.trackId;
            inversePayload.expectedDeviceIds = expectedDeviceIds;
        }
        return {
            label: `Add ${action.payload.deviceType}`,
            inverseAction: { type: 'removeDevice', payload: inversePayload },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
