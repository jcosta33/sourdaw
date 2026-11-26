import { getHeads } from '@automerge/automerge';

import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import { applyDevicePatchState, captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { getCrdtDoc, readOwnedProjectPublications } from '#/modules/CrdtDocument/useCases';
import { createHandler } from '#/utils/createHandler';
import { type HandlerExecutionResult } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type CrustFactoryPresetAction } from '../events/crustAppActions';
import { DEFAULT_CRUST_PATCH, type CrustPatch } from '../models/CrustPatch';
import { CRUST_PRESET_PARAMETER_ORDER } from '../models/CrustPresetParameterOrder';
import { crustPresetPreviewAuthority } from '../useCases/createCrustParameterGesture';
import { encodeCrustPresetParameters } from '../useCases/crustParamBridge/encodeCrustPresetParameters';
import { syncCrustPresetRuntime } from '../useCases/crustParamBridge/syncCrustPresetRuntime';
import { CRUST_PRESETS, type CrustPreset, getCrustFactoryPreset } from '../useCases/crustPresets';
import { readCrustFactoryPresetTarget } from '../useCases/readCrustFactoryPresetTarget';

import {
    invertCrustFactoryPresetAction,
    isCrustFactoryPresetSessionEntry,
    validCrustFactoryPresetCapture,
} from './crustFactoryPresetCapture';

type Payload = CrustFactoryPresetAction['payload'];
type Admission = NonNullable<ReturnType<typeof captureDevicePatchCommitValidation>>;
const admissions = new WeakMap<CrustFactoryPresetAction, Admission>();

function readGuardedOwner({ deviceId, trackId, trackObjectId, deviceObjectId, deviceIds }: Payload) {
    const owner = readCrustFactoryPresetTarget(deviceId);
    return owner?.trackId === trackId &&
        owner.trackObjectId === trackObjectId &&
        owner.deviceObjectId === deviceObjectId &&
        valuesEqual(owner.deviceIds, deviceIds)
        ? owner
        : null;
}

function matchesSource(payload: Payload): boolean {
    const owner = readGuardedOwner(payload);
    return owner !== null && valuesEqual(owner.state.parameterValues, payload.before);
}

function stagePresetProjection(action: CrustFactoryPresetAction, admission: Admission, mutationOwner: object) {
    const { payload } = action;
    const matchesWrittenProjection = (): boolean =>
        valuesEqual(readGuardedOwner(payload)?.state.parameterValues, payload.after);
    const rootPublications = () =>
        readOwnedProjectPublications(mutationOwner).filter((publication) => publication.docId === 'root');
    crustPresetPreviewAuthority.stage(action, payload.deviceId, () => {
        if (!matchesWrittenProjection()) {
            return false;
        }
        if (getCurrentAutomergeStorageMutationOwner() === mutationOwner && admission.isCurrent()) {
            return true;
        }
        // Repository listeners run outside the publisher's storage scope.
        const root = getCrdtDoc('root');
        if (!root || !admission.matchesCommittedParameters(payload.after)) {
            return false;
        }
        const heads = getHeads(root);
        return rootPublications().some(
            (publication) =>
                publication.heads.length === heads.length && heads.every((head) => publication.heads.includes(head))
        );
    });
    return (): boolean =>
        rootPublications().length > 0 &&
        admission.matchesCommittedParameters(payload.after) &&
        matchesWrittenProjection();
}

function committedPresetMetadata(payload: Payload): Pick<CrustPatch, 'name' | 'streamingPreset'> {
    const selected = getCrustFactoryPreset(payload.presetId);
    const matches = (preset: CrustPreset): boolean =>
        valuesEqual(encodeCrustPresetParameters(preset.patch), payload.after);
    return (selected && matches(selected) ? selected : CRUST_PRESETS.find(matches))?.patch ?? DEFAULT_CRUST_PATCH;
}

function executePreset(action: CrustFactoryPresetAction): HandlerExecutionResult {
    const admission = admissions.get(action);
    admissions.delete(action);
    const payload = action.payload;
    const owner = readGuardedOwner(payload);
    const mutationOwner = getCurrentAutomergeStorageMutationOwner();
    if (
        !admission ||
        !owner ||
        !mutationOwner ||
        !validCrustFactoryPresetCapture(payload) ||
        !valuesEqual(owner.state.parameterValues, payload.before)
    ) {
        return { status: 'conflict' };
    }
    const proof = admission.start();
    if (!proof) {
        return { status: 'conflict' };
    }
    const next = { deviceState: owner.state.deviceState, parameterValues: payload.after };
    let validationTransferred = false;
    try {
        const isCurrent = stagePresetProjection(action, admission, mutationOwner);
        if (
            !applyDevicePatchState({ deviceId: payload.deviceId, expected: owner.state, next }) ||
            !proof.captureWrittenState(next)
        ) {
            return { status: 'conflict' };
        }
        const sync = (): void => {
            crustPresetPreviewAuthority.release(action);
            syncCrustPresetRuntime({
                trackId: payload.trackId,
                deviceId: payload.deviceId,
                parameters: payload.after,
                metadata: committedPresetMetadata(payload),
                isCurrent,
            });
        };
        validationTransferred = true;
        return { status: 'written', commitValidation: proof.validation, afterCommit: sync, afterAmbiguousCommit: sync };
    } finally {
        if (!validationTransferred) {
            crustPresetPreviewAuthority.release(action);
            proof.validation.release();
        }
    }
}

export const handleSetCrustFactoryPreset = createHandler<'setCrustFactoryPreset'>({
    validate: ({ payload }) => validCrustFactoryPresetCapture(payload) && matchesSource(payload),
    describe: (action) => {
        admissions.delete(action);
        const { payload } = action;
        if (validCrustFactoryPresetCapture(payload) && matchesSource(payload)) {
            const admission = captureDevicePatchCommitValidation({
                trackId: payload.trackId,
                deviceId: payload.deviceId,
                parameterIds: CRUST_PRESET_PARAMETER_ORDER,
                requireCurrentProjection: true,
            });
            if (admission) {
                admissions.set(action, admission);
            }
        }
        const preset = getCrustFactoryPreset(payload.presetId);
        return {
            label: preset ? `Load ${preset.name}` : 'Load Crust preset',
            inverseAction: invertCrustFactoryPresetAction(action),
            redoAction: action,
        };
    },
    execute: executePreset,
    prepareAbort: (action) => () => crustPresetPreviewAuthority.release(action),
    isNoop: ({ payload }) =>
        validCrustFactoryPresetCapture(payload) && valuesEqual(payload.before, payload.after) && matchesSource(payload),
    validateSessionActionArguments: validCrustFactoryPresetCapture,
    validateSessionEntry: isCrustFactoryPresetSessionEntry,
    batchExecution: 'singleton',
    previewExecution: 'unsupported-external',
    requiresAbortCompensation: false,
    canReportConflict: true,
    undoable: true,
});
