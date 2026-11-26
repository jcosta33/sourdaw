import { applyDevicePatchState, captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type ToasterMasterGainAction } from '../events/toasterAppActions';
import { compileToasterMasterGainPatch } from '../models/ToasterMasterGainPatch';
import { getToasterMasterGainTarget } from '../useCases/getToasterMasterGainTarget';

import {
    invertToasterMasterGainAction,
    isToasterMasterGainSessionEntry,
    validToasterMasterGainAction,
} from './toasterMasterGainActionValidation';

type Admission = NonNullable<ReturnType<typeof captureDevicePatchCommitValidation>>;
const admissions = new WeakMap<ToasterMasterGainAction, Admission>();

function writePlannedChange(
    patch: NonNullable<ReturnType<typeof plan>>,
    proof: ReturnType<Admission['start']> | null | undefined
): boolean {
    return applyDevicePatchState(patch) && (!proof || proof.captureWrittenState(patch.next));
}

function plan(action: ToasterMasterGainAction, context?: HandlerValidationContext) {
    if (!validToasterMasterGainAction(action.payload) || (context && context.actions.length !== 1)) {
        return null;
    }
    const { deviceId, trackId, deviceIds } = action.payload;
    const target = getToasterMasterGainTarget(deviceId);
    if (!target || target.trackId !== trackId || !valuesEqual(target.deviceIds, deviceIds)) {
        return null;
    }
    const patch = compileToasterMasterGainPatch(target.current, action.payload);
    if (!patch) {
        return null;
    }
    return {
        deviceId,
        expected: { deviceState: target.current.chunk, parameterValues: {} },
        next: { deviceState: patch.nextChunk, parameterValues: {} },
    };
}

function admit(action: ToasterMasterGainAction, context?: HandlerValidationContext): boolean {
    admissions.delete(action);
    if (!plan(action, context)) {
        return false;
    }
    if (context?.executionMode === 'isolated-preview') {
        return true;
    }
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

export const handleSetToasterMasterGain = createHandler<'setToasterMasterGain'>({
    validate: admit,
    canReapplyAfterDivergence: (action, context) => plan(action, context) !== null,
    execute: (action, context) => {
        const admission = admissions.get(action);
        admissions.delete(action);
        const patch = plan(action, context);
        if (!patch) {
            return { status: 'conflict' };
        }
        const preview = context?.executionMode === 'isolated-preview';
        const proof = preview ? null : admission?.start();
        if (!preview && !proof) {
            return { status: 'conflict' };
        }
        let validationTransferred = false;
        try {
            if (!writePlannedChange(patch, proof)) {
                return { status: 'conflict' };
            }
            validationTransferred = true;
            return { status: 'written', commitValidation: proof?.validation };
        } finally {
            if (!validationTransferred) {
                proof?.validation.release();
            }
        }
    },
    describe: (action, context) => {
        const label = 'Set Toaster Master gain';
        if (!admit(action, context)) {
            return { label };
        }
        return { label, inverseAction: invertToasterMasterGainAction(action), redoAction: action };
    },
    validateSessionActionArguments: validToasterMasterGainAction,
    validateSessionEntry: isToasterMasterGainSessionEntry,
    previewExecution: 'isolated-project',
    batchExecution: 'singleton',
    requiresAbortCompensation: false,
    canReportConflict: true,
    undoable: true,
});
