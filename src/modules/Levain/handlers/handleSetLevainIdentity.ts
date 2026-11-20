import { type Device, resolveEligibleDeviceWriteTarget, trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    applyDevicePatchState,
    captureDevicePatchCommitValidation,
    getPlannedDevicePatchState,
} from '#/modules/Arrangement/useCases';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/stores';
import { projectTransitionEpoch } from '#/modules/Project/stores';
import { createHandler } from '#/utils/createHandler';
import { type HandlerExecutionResult, type HandlerValidationContext } from '#/utils/handlerContract';
import { resolveDevicePatchTransition } from '#/utils/resolveDevicePatchTransition';
import { valuesEqual } from '#/utils/structuralEquality';

import { type SetLevainIdentityAction } from '../events/levainAppActions';
import { fromLevainDeviceState } from '../models/LevainDeviceState';
import { DEFAULT_LEVAIN_INSTRUMENT_ID } from '../models/LevainPatch';
import { reconcileLevainDeviceStateFromProject } from '../useCases/reconcileLevainDeviceStateFromProject';
import { reflectLevainBankChange } from '../useCases/reflectLevainBankChange';

import {
    invertLevainIdentityAction,
    isLevainIdentitySessionEntry,
    validLevainIdentityCapture,
} from './levainIdentityActionValidation';
import { admitsLevainIdentityBatch } from './levainIdentityBatchAdmission';

type Admission = NonNullable<ReturnType<typeof captureDevicePatchCommitValidation>>;
const admissions = new WeakMap<SetLevainIdentityAction, Admission>();

function resolveIdentityTransition(action: SetLevainIdentityAction, context?: HandlerValidationContext) {
    const { deviceId, trackId, deviceIds, before, after, missingDeviceState } = action.payload;
    const planned = getPlannedDevicePatchState({
        deviceId,
        trackId,
        parameterIds: Object.keys(before.parameterValues),
        context,
    });
    if (planned?.deviceType !== 'levain' || planned.frozen || !valuesEqual(planned.deviceIds, deviceIds)) {
        return null;
    }
    return resolveDevicePatchTransition(planned.state, before, after, {
        field: 'disclosureTier',
        allowedValues: ['basic', 'expert'],
        missingChunk: missingDeviceState,
    });
}

type Transition = NonNullable<ReturnType<typeof resolveIdentityTransition>>;

function admit(action: SetLevainIdentityAction, context?: HandlerValidationContext): boolean {
    admissions.delete(action);
    if (context?.executionMode === 'isolated-preview') {
        return true;
    }
    const { deviceId, trackId, before } = action.payload;
    const proof = captureDevicePatchCommitValidation({
        trackId,
        deviceId,
        parameterIds: Object.keys(before.parameterValues),
        requireCurrentProjection: true,
    });
    if (!proof) {
        return false;
    }
    admissions.set(action, proof);
    return true;
}

function instrumentOf(device: Device | undefined) {
    return fromLevainDeviceState(device?.deviceState)?.instrumentId ?? DEFAULT_LEVAIN_INSTRUMENT_ID;
}

function createRuntimeEffect(action: SetLevainIdentityAction, before: Track, context?: HandlerValidationContext) {
    const { deviceId, kind, trackId } = action.payload;
    const transition = projectTransitionEpoch.captureEditAuthority();
    const root = captureProjectRootIdentity();
    const previous = before.devices.find(({ id }) => id === deviceId);
    const priorInstrumentEdit = context?.actions
        .slice(0, context.actionIndex)
        .some(
            (sibling) =>
                sibling.type === 'setLevainIdentity' &&
                sibling.payload.deviceId === deviceId &&
                sibling.payload.kind === 'instrument'
        );
    return function reflectCommittedIdentity(): void {
        if (!transition.isCurrent() || captureProjectRootIdentity() !== root) {
            return;
        }
        const target = resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible' || target.trackId !== trackId) {
            return;
        }
        const current = trackStore.value?.tracks.find(({ id }) => id === trackId);
        if (!current || current.frozen) {
            return;
        }
        const device = current.devices.find(({ id }) => id === deviceId);
        if (device?.type !== 'levain') {
            return;
        }
        const sameBankReset =
            kind === 'instrument' && !priorInstrumentEdit && instrumentOf(previous) === instrumentOf(device);
        reconcileLevainDeviceStateFromProject(deviceId, { projectPatch: sameBankReset });
        if (kind === 'instrument' && !priorInstrumentEdit) {
            reflectLevainBankChange(before, current, deviceId);
        }
    };
}

function writeIdentity(
    action: SetLevainIdentityAction,
    transition: Transition,
    proof: NonNullable<ReturnType<Admission['start']>>,
    context?: HandlerValidationContext
): HandlerExecutionResult {
    const { deviceId, trackId } = action.payload;
    let transferred = false;
    try {
        const owner = trackStore.value?.tracks.find(({ id }) => id === trackId);
        if (!owner) {
            return { status: 'conflict' };
        }
        const snapshot = { ...owner, devices: structuredClone(owner.devices) };
        if (!applyDevicePatchState({ deviceId, ...transition }) || !proof.captureWrittenState(transition.next)) {
            return { status: 'conflict' };
        }
        const reflect = createRuntimeEffect(action, snapshot, context);
        transferred = true;
        return {
            status: 'written',
            commitValidation: proof.validation,
            afterCommit: reflect,
            afterAmbiguousCommit: reflect,
        };
    } finally {
        if (!transferred) {
            proof.validation.release();
        }
    }
}

export const handleSetLevainIdentity = createHandler<'setLevainIdentity'>({
    validate: (action, context) =>
        validLevainIdentityCapture(action.payload) &&
        admitsLevainIdentityBatch(action, context) &&
        resolveIdentityTransition(action, context) !== null &&
        admit(action, context),
    canReapplyAfterDivergence: (action, context) =>
        validLevainIdentityCapture(action.payload) &&
        admitsLevainIdentityBatch(action, context) &&
        resolveIdentityTransition(action, context) !== null,
    execute: (action, context) => {
        const admission = admissions.get(action);
        admissions.delete(action);
        if (!validLevainIdentityCapture(action.payload)) {
            return { status: 'conflict' };
        }
        const transition = resolveIdentityTransition(action);
        if (!transition) {
            return { status: 'conflict' };
        }
        if (context?.executionMode === 'isolated-preview') {
            const { deviceId } = action.payload;
            return {
                status: applyDevicePatchState({ deviceId, ...transition }) ? 'written' : 'conflict',
            };
        }
        const proof = admission?.start();
        return proof ? writeIdentity(action, transition, proof, context) : { status: 'conflict' };
    },
    describe: (action, context) => {
        if (validLevainIdentityCapture(action.payload)) {
            // The single-action entry point describes the action without batch validation.
            admit(action, context);
        }
        return { label: action.payload.label, inverseAction: invertLevainIdentityAction(action), redoAction: action };
    },
    isNoop: (action) => {
        if (!validLevainIdentityCapture(action.payload)) {
            return false;
        }
        const transition = resolveIdentityTransition(action);
        return transition !== null && valuesEqual(transition.expected, transition.next);
    },
    validateSessionActionArguments: validLevainIdentityCapture,
    validateSessionEntry: isLevainIdentitySessionEntry,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    canReportConflict: true,
    undoable: true,
});
