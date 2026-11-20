import { applyDevicePatchState, captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { type HandlerExecutionResult } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type ProofPatchSelectionAction } from '../events/proofAppActions';
import { TARGET_LABELS } from '../models/ProofPatch';
import { proofPatchSelectionParameterIds } from '../services/proofPatchSelectionParameterIds';
import { syncProofPatchSelection } from '../useCases/proofParamBridge/syncProofPatchSelection';
import { getProofFactoryPreset } from '../useCases/proofPresets';
import { readProofPatchSelectionOwner } from '../useCases/readProofPatchSelectionOwner';

import {
    invertProofPatchSelection,
    isProofPatchSelectionSessionEntry,
    validProofPatchSelectionCapture,
} from './proofPatchSelectionCapture';

type Payload = ProofPatchSelectionAction['payload'];
type Admission = NonNullable<ReturnType<typeof captureDevicePatchCommitValidation>>;
const admissions = new WeakMap<ProofPatchSelectionAction, Admission>();

function readGuardedOwner({ deviceId, trackId, deviceIds, selection }: Payload) {
    const owner = readProofPatchSelectionOwner(deviceId, proofPatchSelectionParameterIds(selection.kind));
    return owner?.trackId === trackId && valuesEqual(owner.deviceIds, deviceIds) ? owner : null;
}

function matchesSource(payload: Payload): boolean {
    const owner = readGuardedOwner(payload);
    return owner !== null && valuesEqual(owner.state.parameterValues, payload.before.parameters);
}

function executeSelection(action: ProofPatchSelectionAction): HandlerExecutionResult {
    const admission = admissions.get(action);
    admissions.delete(action);
    const { payload } = action;
    if (!admission || !validProofPatchSelectionCapture(payload)) {
        return { status: 'conflict' };
    }
    const owner = readGuardedOwner(payload);
    if (!owner || !valuesEqual(owner.state.parameterValues, payload.before.parameters)) {
        return { status: 'conflict' };
    }
    const proof = admission.start();
    if (!proof) {
        return { status: 'conflict' };
    }
    const next = { deviceState: owner.state.deviceState, parameterValues: payload.after.parameters };
    let validationTransferred = false;
    try {
        if (
            !applyDevicePatchState({ deviceId: payload.deviceId, expected: owner.state, next }) ||
            !proof.captureWrittenState(next)
        ) {
            return { status: 'conflict' };
        }
        const sync = (): void => {
            const committed = readGuardedOwner(payload);
            if (
                committed &&
                valuesEqual(committed.state.parameterValues, payload.after.parameters) &&
                admission.matchesCommittedParameters(payload.after.parameters)
            ) {
                syncProofPatchSelection(payload.deviceId, payload.selection, payload.after);
            }
        };
        validationTransferred = true;
        return { status: 'written', commitValidation: proof.validation, afterCommit: sync, afterAmbiguousCommit: sync };
    } finally {
        if (!validationTransferred) {
            proof.validation.release();
        }
    }
}

function describeSelection({ selection }: Payload): string {
    if (selection.kind === 'target') {
        return `Set Proof target to ${TARGET_LABELS[selection.target]}`;
    }
    const preset = getProofFactoryPreset(selection.presetId);
    return preset ? `Load ${preset.name}` : 'Load Proof preset';
}

export const handleSetProofPatchSelection = createHandler<'setProofPatchSelection'>({
    validate: ({ payload }) => validProofPatchSelectionCapture(payload) && matchesSource(payload),
    describe: (action) => {
        admissions.delete(action);
        const { payload } = action;
        if (validProofPatchSelectionCapture(payload) && matchesSource(payload)) {
            const admission = captureDevicePatchCommitValidation({
                trackId: payload.trackId,
                deviceId: payload.deviceId,
                parameterIds: proofPatchSelectionParameterIds(payload.selection.kind),
                requireCurrentProjection: true,
            });
            if (admission) {
                admissions.set(action, admission);
            }
        }
        return {
            label: describeSelection(payload),
            inverseAction: invertProofPatchSelection(action),
            redoAction: action,
        };
    },
    execute: executeSelection,
    isNoop: ({ payload }) =>
        validProofPatchSelectionCapture(payload) &&
        valuesEqual(payload.before.parameters, payload.after.parameters) &&
        matchesSource(payload),
    validateSessionActionArguments: validProofPatchSelectionCapture,
    validateSessionEntry: isProofPatchSelectionSessionEntry,
    batchExecution: 'singleton',
    previewExecution: 'unsupported-external',
    requiresAbortCompensation: false,
    canReportConflict: true,
    undoable: true,
});
