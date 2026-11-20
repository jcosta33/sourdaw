import { applyDevicePatchState, captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { projectTransitionEpoch } from '#/modules/Project/stores';
import { createHandler } from '#/utils/createHandler';
import { type HandlerExecutionResult, type HandlerValidationContext } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type BacteriaFactoryPatchAction, type BacteriaFactoryPatchSnapshot } from '../events/bacteriaAppActions';
import { bacteriaFactoryPatchPublication } from '../useCases/bacteriaParamBridge/bacteriaFactoryPatchPublication';
import { readBacteriaFactoryPatchTarget } from '../useCases/bacteriaParamBridge/readBacteriaFactoryPatchTarget';
import { reconcileBacteriaFactoryPatch } from '../useCases/bacteriaParamBridge/reconcileBacteriaFactoryPatch';

import {
    invertBacteriaFactoryPatch,
    isBacteriaFactoryPatchSessionEntry,
    validBacteriaFactoryPatchCapture,
} from './bacteriaFactoryPatchActionValidation';

type Payload = BacteriaFactoryPatchAction['payload'];
type Admission = NonNullable<ReturnType<typeof captureDevicePatchCommitValidation>>;
const admissions = new WeakMap<BacteriaFactoryPatchAction, Admission>();

function targetMatches(
    { deviceId, trackId, deviceIds }: Payload,
    expected: BacteriaFactoryPatchSnapshot,
    context?: HandlerValidationContext
): boolean {
    const target = readBacteriaFactoryPatchTarget(deviceId, Object.keys(expected.parameterValues), trackId, context);
    return (
        target !== null &&
        valuesEqual(target.deviceIds, deviceIds) &&
        valuesEqual(target.state.deviceState, expected.deviceState) &&
        valuesEqual(target.state.parameterValues, expected.parameterValues)
    );
}

function admit(action: BacteriaFactoryPatchAction, context?: HandlerValidationContext): boolean {
    admissions.delete(action);
    if (context?.executionMode === 'isolated-preview') {
        return true;
    }
    const { trackId, deviceId, before } = action.payload;
    const authority = captureDevicePatchCommitValidation({
        trackId,
        deviceId,
        parameterIds: Object.keys(before.parameterValues),
        requireCurrentProjection: true,
    });
    if (!authority) {
        return false;
    }
    admissions.set(action, authority);
    return true;
}

function createReconcile(payload: Payload): () => void {
    const identity = captureProjectIdentity();
    const authority = projectTransitionEpoch.captureEditAuthority();
    return () => {
        try {
            if (
                authority.isCurrent() &&
                captureProjectIdentity() === identity &&
                targetMatches(payload, payload.after)
            ) {
                reconcileBacteriaFactoryPatch(payload);
            }
        } finally {
            bacteriaFactoryPatchPublication.release(payload);
        }
    };
}

function writeFactoryPatch(
    payload: Payload,
    proof: ReturnType<Admission['start']> | undefined
): HandlerExecutionResult {
    const { deviceId, before, after } = payload;
    let transferred = false;
    try {
        if (proof) {
            bacteriaFactoryPatchPublication.hold(payload);
        }
        if (!applyDevicePatchState({ deviceId, expected: before, next: after })) {
            return { status: 'conflict' };
        }
        if (proof && !proof.captureWrittenState(after)) {
            return { status: 'conflict' };
        }
        const reconcile = createReconcile(payload);
        transferred = true;
        return {
            status: 'written',
            commitValidation: proof?.validation,
            afterCommit: reconcile,
            afterAmbiguousCommit: reconcile,
        };
    } finally {
        if (!transferred) {
            bacteriaFactoryPatchPublication.release(payload);
            proof?.validation.release();
        }
    }
}

export const handleSetBacteriaFactoryPatch = createHandler<'setBacteriaFactoryPatch'>({
    validate: (action, context) =>
        validBacteriaFactoryPatchCapture(action.payload) &&
        targetMatches(action.payload, action.payload.before, context) &&
        admit(action, context),
    prepareAbort:
        ({ payload }) =>
        () =>
            bacteriaFactoryPatchPublication.release(payload),
    execute: (action, context) => {
        const admission = admissions.get(action);
        admissions.delete(action);
        if (
            !validBacteriaFactoryPatchCapture(action.payload) ||
            !targetMatches(action.payload, action.payload.before)
        ) {
            return { status: 'conflict' };
        }
        if (context?.executionMode === 'isolated-preview') {
            return writeFactoryPatch(action.payload, undefined);
        }
        const proof = admission?.start();
        if (!proof) {
            return { status: 'conflict' };
        }
        return writeFactoryPatch(action.payload, proof);
    },
    describe: (action, context) => {
        // Single-action replay invokes describe before execute without validate.
        if (validBacteriaFactoryPatchCapture(action.payload)) {
            admit(action, context);
        }
        return {
            label: action.payload.label,
            inverseAction: invertBacteriaFactoryPatch(action),
            redoAction: action,
        };
    },
    isNoop: (action) => {
        const { before, after } = action.payload;
        return (
            validBacteriaFactoryPatchCapture(action.payload) &&
            valuesEqual(before.deviceState, after.deviceState) &&
            valuesEqual(before.parameterValues, after.parameterValues) &&
            targetMatches(action.payload, before)
        );
    },
    validateSessionActionArguments: validBacteriaFactoryPatchCapture,
    validateSessionEntry: isBacteriaFactoryPatchSessionEntry,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    canReportConflict: true,
    undoable: true,
});
