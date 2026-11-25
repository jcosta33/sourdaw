import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { applyDevicePatchState, captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { projectTransitionEpoch } from '#/modules/Project/stores';
import { createHandler } from '#/utils/createHandler';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type GrandBouleAppAction } from '../events/grandBouleAppActions';
import { fromGrandBouleDeviceState } from '../models/GrandBouleDeviceState';
import { reconcileGrandBouleDeviceStateFromProject } from '../useCases/reconcileGrandBouleDeviceStateFromProject';

type Admission = NonNullable<ReturnType<typeof captureDevicePatchCommitValidation>>;
const admissions = new WeakMap<GrandBouleAppAction, Admission>();

function validChunk(chunk: unknown): boolean {
    return chunk === null || fromGrandBouleDeviceState(chunk) !== null;
}

function validCapture(payload: unknown): boolean {
    return (
        isRecord(payload) &&
        Object.keys(payload).length === 4 &&
        typeof payload.deviceId === 'string' &&
        payload.deviceId.length > 0 &&
        typeof payload.trackId === 'string' &&
        payload.trackId.length > 0 &&
        validChunk(payload.before) &&
        validChunk(payload.after)
    );
}

function invert(action: GrandBouleAppAction): GrandBouleAppAction {
    const { before, after } = action.payload;
    return { ...action, payload: { ...action.payload, before: after, after: before } };
}

function sourceMatches(action: GrandBouleAppAction): boolean {
    const { deviceId, trackId, before } = action.payload;
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible' || target.trackId !== trackId) {
        return false;
    }
    const track = trackStore.value?.tracks.find(({ id }) => id === trackId);
    const device = track?.devices.find(({ id }) => id === deviceId);
    return (
        device?.type === DEVICE_TYPE_IDS.grandBoule &&
        !track?.frozen &&
        Object.hasOwn(device, 'deviceState') === (before !== null) &&
        (before === null || valuesEqual(device.deviceState, before))
    );
}

function admit(action: GrandBouleAppAction): boolean {
    admissions.delete(action);
    const { deviceId, trackId } = action.payload;
    const admission = captureDevicePatchCommitValidation({
        deviceId,
        trackId,
        parameterIds: [],
        requireCurrentProjection: true,
    });
    if (!admission) {
        return false;
    }
    admissions.set(action, admission);
    return true;
}

export const handleSetGrandBouleDeviceState = createHandler<'setGrandBouleDeviceState'>({
    validate: (action) => validCapture(action.payload) && sourceMatches(action) && admit(action),
    execute: (action) => {
        const admission = admissions.get(action);
        admissions.delete(action);
        if (!validCapture(action.payload) || !sourceMatches(action)) {
            return { status: 'conflict' };
        }
        const proof = admission?.start();
        if (!proof) {
            return { status: 'conflict' };
        }
        const { deviceId, before, after } = action.payload;
        const expected = { deviceState: before, parameterValues: {} };
        const next = { deviceState: after, parameterValues: {} };
        let validationTransferred = false;
        try {
            if (!applyDevicePatchState({ deviceId, expected, next }) || !proof.captureWrittenState(next)) {
                return { status: 'conflict' };
            }
            const transition = projectTransitionEpoch.captureEditAuthority();
            const reconcile = (): void => {
                if (transition.isCurrent()) {
                    reconcileGrandBouleDeviceStateFromProject(deviceId);
                }
            };
            validationTransferred = true;
            return {
                status: 'written',
                commitValidation: proof.validation,
                afterCommit: reconcile,
                afterAmbiguousCommit: reconcile,
            };
        } finally {
            if (!validationTransferred) {
                proof.validation.release();
            }
        }
    },
    describe: (action) => {
        // Single-action replay calls describe before execution without running validate.
        if (validCapture(action.payload)) {
            admit(action);
        }
        return { label: 'Change Grand Boule voicing', inverseAction: invert(action), redoAction: action };
    },
    isNoop: (action) =>
        validCapture(action.payload) &&
        valuesEqual(action.payload.before, action.payload.after) &&
        sourceMatches(action),
    validateSessionActionArguments: validCapture,
    validateSessionEntry: ({ action, inverseAction, redoAction }) =>
        action.type === 'setGrandBouleDeviceState' &&
        validCapture(action.payload) &&
        !valuesEqual(action.payload.before, action.payload.after) &&
        valuesEqual(inverseAction, invert(action)) &&
        valuesEqual(redoAction, action),
    batchExecution: 'singleton',
    previewExecution: 'unsupported-external',
    requiresAbortCompensation: false,
    undoable: true,
});
