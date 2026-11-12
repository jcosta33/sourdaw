import {
    applyDevicePatchState,
    captureDevicePatchCommitValidation,
    getPlannedDevicePatchState,
} from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { fermenterPatchesEqual, fromFermenterDeviceState } from '../models/FermenterPatchState';
import {
    fermenterPatchProjectStatesEqual,
    fermenterProjectStateMatchesPatch,
    readFermenterPatchProjectState,
} from '../models/FermenterPatchProjectState';
import { reconcileFermenterPatchFromProject } from '../useCases/reconcileFermenterPatchFromProject';

type PatchAction = Extract<AppAction, { type: 'setFermenterPatch' }>;
type Admission = NonNullable<ReturnType<typeof captureDevicePatchCommitValidation>>;
const admissions = new WeakMap<PatchAction, Admission>();

function target(action: PatchAction, context?: HandlerValidationContext) {
    return getPlannedDevicePatchState({
        deviceId: action.payload.deviceId,
        trackId: action.payload.expectedTrackId,
        parameterIds: Object.keys(action.payload.expectedProject.parameterValues),
        context,
    });
}

function validCaptures(action: PatchAction): boolean {
    const before = fromFermenterDeviceState(action.payload.before);
    const after = fromFermenterDeviceState(action.payload.after);
    const expected = fromFermenterDeviceState(action.payload.expectedCurrent);
    return (
        before !== null &&
        after !== null &&
        expected !== null &&
        fermenterProjectStateMatchesPatch(action.payload.beforeProject, before) &&
        fermenterProjectStateMatchesPatch(action.payload.afterProject, after) &&
        fermenterProjectStateMatchesPatch(action.payload.expectedProject, expected)
    );
}

function guardsMatch(action: PatchAction, context?: HandlerValidationContext): boolean {
    const current = target(action, context);
    const expected = fromFermenterDeviceState(action.payload.expectedCurrent);
    return (
        current !== null &&
        current.deviceType === 'fermenter' &&
        !current.frozen &&
        expected !== null &&
        current.trackId === action.payload.expectedTrackId &&
        current.frozen === action.payload.expectedTrackFrozen &&
        current.deviceIds.length === action.payload.expectedDeviceIds.length &&
        current.deviceIds.every((id, index) => action.payload.expectedDeviceIds[index] === id) &&
        fermenterPatchProjectStatesEqual(current.state, action.payload.expectedProject) &&
        fermenterPatchesEqual(readFermenterPatchProjectState(current.state), expected)
    );
}

function admit(action: PatchAction, context?: HandlerValidationContext): boolean {
    admissions.delete(action);
    if (context?.executionMode === 'isolated-preview') {
        return true;
    }
    const source = captureDevicePatchCommitValidation({
        trackId: action.payload.expectedTrackId,
        deviceId: action.payload.deviceId,
        parameterIds: Object.keys(action.payload.expectedProject.parameterValues),
    });
    if (!source) {
        return false;
    }
    admissions.set(action, source);
    return true;
}

export const handleSetFermenterPatch = createHandler<'setFermenterPatch'>({
    validate: (action, context) => validCaptures(action) && guardsMatch(action, context) && admit(action, context),
    execute: (action, context) => {
        const admission = admissions.get(action);
        admissions.delete(action);
        if (!validCaptures(action) || !guardsMatch(action)) {
            return { status: 'conflict' };
        }
        const preview = context?.executionMode === 'isolated-preview';
        const proof = preview ? null : admission?.start();
        if (!preview && !proof) {
            return { status: 'conflict' };
        }
        let validationTransferred = false;
        try {
            if (
                !applyDevicePatchState({
                    deviceId: action.payload.deviceId,
                    expected: action.payload.expectedProject,
                    next: action.payload.afterProject,
                })
            ) {
                return { status: 'conflict' };
            }
            if (proof && !proof.captureWrittenState(action.payload.afterProject)) {
                return { status: 'conflict' };
            }
            const reconcile = (): void => reconcileFermenterPatchFromProject(action.payload.deviceId);
            validationTransferred = true;
            return {
                status: 'written',
                commitValidation: proof?.validation,
                afterCommit: reconcile,
                afterAmbiguousCommit: reconcile,
            };
        } finally {
            // Command owns cleanup only after a successful handler return carries the proof.
            if (!validationTransferred) {
                proof?.validation.release();
            }
        }
    },
    describe: (action, context) => {
        admit(action, context);
        return {
            label: action.payload.label,
            inverseAction: {
                type: 'setFermenterPatch',
                payload: {
                    ...action.payload,
                    before: action.payload.after,
                    after: action.payload.before,
                    expectedCurrent: action.payload.after,
                    beforeProject: action.payload.afterProject,
                    afterProject: action.payload.beforeProject,
                    expectedProject: action.payload.afterProject,
                },
            },
            redoAction: {
                ...action,
                payload: {
                    ...action.payload,
                    expectedCurrent: action.payload.before,
                    expectedProject: action.payload.beforeProject,
                },
            },
        };
    },
    isNoop: (action) => {
        const current = target(action);
        return (
            current !== null &&
            validCaptures(action) &&
            fermenterPatchProjectStatesEqual(current.state, action.payload.afterProject)
        );
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    canReportConflict: true,
    undoable: true,
});
