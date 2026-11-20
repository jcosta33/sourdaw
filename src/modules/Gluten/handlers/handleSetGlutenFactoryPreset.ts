import { applyDevicePatchState, captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { type HandlerExecutionResult } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type GlutenFactoryPresetAction } from '../events/glutenAppActions';
import { DEFAULT_PATCH } from '../models/GlutenPatch';
import { GLUTEN_PRESET_PARAMETER_ORDER } from '../models/GlutenPresetParameterOrder';
import { getGlutenFactoryPreset } from '../useCases/getGlutenFactoryPreset';
import { encodeGlutenPresetParameters } from '../useCases/glutenParamBridge/encodeGlutenPresetParameters';
import { syncGlutenPresetRuntime } from '../useCases/glutenParamBridge/syncGlutenPresetRuntime';
import { GLUTEN_PRESETS } from '../useCases/glutenPresets';
import { readGlutenFactoryPresetTarget } from '../useCases/readGlutenFactoryPresetTarget';

import {
    invertGlutenFactoryPresetAction,
    isGlutenFactoryPresetSessionEntry,
    validGlutenFactoryPresetCapture,
} from './glutenFactoryPresetCapture';

type Payload = GlutenFactoryPresetAction['payload'];
type Admission = NonNullable<ReturnType<typeof captureDevicePatchCommitValidation>>;
const admissions = new WeakMap<GlutenFactoryPresetAction, Admission>();

function readGuardedOwner({ deviceId, trackId, deviceIds }: Payload) {
    const owner = readGlutenFactoryPresetTarget(deviceId);
    return owner?.trackId === trackId && valuesEqual(owner.deviceIds, deviceIds) ? owner : null;
}

function matchesSource(payload: Payload): boolean {
    const owner = readGuardedOwner(payload);
    return owner !== null && valuesEqual(owner.state.parameterValues, payload.before);
}

function committedPatchName(payload: Payload): string {
    const selected = getGlutenFactoryPreset(payload.presetId);
    if (selected && valuesEqual(encodeGlutenPresetParameters(selected.patch), payload.after)) {
        return selected.name;
    }
    // Bus Glue shares the initial patch's numbers. Only a selection identifies it.
    if (valuesEqual(encodeGlutenPresetParameters(DEFAULT_PATCH), payload.after)) {
        return DEFAULT_PATCH.name;
    }
    return (
        GLUTEN_PRESETS.find((preset) => valuesEqual(encodeGlutenPresetParameters(preset.patch), payload.after))?.name ??
        DEFAULT_PATCH.name
    );
}

function executePreset(action: GlutenFactoryPresetAction): HandlerExecutionResult {
    const admission = admissions.get(action);
    admissions.delete(action);
    const payload = action.payload;
    const owner = readGuardedOwner(payload);
    if (
        !admission ||
        !owner ||
        !validGlutenFactoryPresetCapture(payload) ||
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
                valuesEqual(committed.state.parameterValues, payload.after) &&
                admission.matchesCommittedParameters(payload.after)
            ) {
                syncGlutenPresetRuntime(payload.trackId, payload.deviceId, payload.after, committedPatchName(payload));
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

export const handleSetGlutenFactoryPreset = createHandler<'setGlutenFactoryPreset'>({
    validate: ({ payload }) => validGlutenFactoryPresetCapture(payload) && matchesSource(payload),
    describe: (action) => {
        admissions.delete(action);
        const { payload } = action;
        if (validGlutenFactoryPresetCapture(payload) && matchesSource(payload)) {
            const admission = captureDevicePatchCommitValidation({
                trackId: payload.trackId,
                deviceId: payload.deviceId,
                parameterIds: GLUTEN_PRESET_PARAMETER_ORDER,
                requireCurrentProjection: true,
            });
            if (admission) {
                admissions.set(action, admission);
            }
        }
        const preset = getGlutenFactoryPreset(payload.presetId);
        return {
            label: preset ? `Load ${preset.name}` : 'Load Gluten preset',
            inverseAction: invertGlutenFactoryPresetAction(action),
            redoAction: action,
        };
    },
    execute: executePreset,
    isNoop: ({ payload }) =>
        validGlutenFactoryPresetCapture(payload) &&
        valuesEqual(payload.before, payload.after) &&
        matchesSource(payload),
    validateSessionActionArguments: validGlutenFactoryPresetCapture,
    validateSessionEntry: isGlutenFactoryPresetSessionEntry,
    batchExecution: 'singleton',
    previewExecution: 'unsupported-external',
    requiresAbortCompensation: false,
    canReportConflict: true,
    undoable: true,
});
