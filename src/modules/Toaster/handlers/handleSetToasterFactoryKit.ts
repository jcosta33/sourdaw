import {
    applyDevicePatchState,
    captureDevicePatchCommitValidation,
    getPlannedDevicePatchState,
} from '#/modules/Arrangement/useCases';
import { projectTransitionEpoch } from '#/modules/Project/stores';
import { createHandler } from '#/utils/createHandler';
import {
    type AppAction,
    type AppActionType,
    type HandlerExecutionResult,
    type HandlerValidationContext,
} from '#/utils/handlerContract';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';
import { valuesEqual } from '#/utils/structuralEquality';

import { type ToasterFactoryKitAction } from '../events/toasterAppActions';
import { reconcileToasterKitFromProject } from '../useCases/reconcileToasterKitFromProject';

import {
    invertToasterFactoryKitAction,
    isToasterFactoryKitSessionEntry,
    validToasterFactoryKitCapture,
} from './toasterFactoryKitActionValidation';

type Admission = NonNullable<ReturnType<typeof captureDevicePatchCommitValidation>>;
const admissions = new WeakMap<ToasterFactoryKitAction, Admission>();

const unplannedTrackChanges = new Set<AppActionType>([
    'freezeTrack',
    'unfreezeTrack',
    'restoreFreezeState',
    'flattenTrack',
    'bounceInPlace',
    'loadPreset',
    'restorePresetDeviceChain',
    'removeTrack',
    'restoreTrack',
    'discardCreatedTrack',
]);

function changesKitDevice(action: AppAction, deviceId: string): boolean {
    if (action.type === 'restoreDevice') {
        return action.payload.deviceSnapshot.id === deviceId;
    }
    return (
        (action.type === 'setDeviceState' || action.type === 'removeDevice' || action.type === 'addDevice') &&
        action.payload.deviceId === deviceId
    );
}

function supportedBatch(action: ToasterFactoryKitAction, context?: HandlerValidationContext): boolean {
    const { deviceId, trackId } = action.payload;
    return (
        context?.actions.every((sibling, index) => {
            if (index === context.actionIndex) {
                return true;
            }
            if (sibling.type === 'removeAllTracks') {
                return false;
            }
            if (sibling.type === 'discardImportedStemSet') {
                return sibling.payload.folderId !== trackId && !sibling.payload.stemTrackIds.includes(trackId);
            }
            if (changesKitDevice(sibling, deviceId)) {
                return false;
            }
            return !(
                unplannedTrackChanges.has(sibling.type) &&
                sibling.payload &&
                'trackId' in sibling.payload &&
                sibling.payload.trackId === trackId
            );
        }) ?? true
    );
}

function guardsMatch(action: ToasterFactoryKitAction, context?: HandlerValidationContext): boolean {
    const { deviceId, trackId, deviceIds, before } = action.payload;
    const planned = getPlannedDevicePatchState({ deviceId, trackId, parameterIds: [], context });
    return (
        planned !== null &&
        planned.deviceType === DEVICE_TYPE_IDS.toaster &&
        !planned.frozen &&
        valuesEqual(planned.deviceIds, deviceIds) &&
        valuesEqual(planned.state.deviceState, before)
    );
}

function admit(action: ToasterFactoryKitAction, context?: HandlerValidationContext): boolean {
    admissions.delete(action);
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

function writeKitChunk(
    { deviceId, before, after }: ToasterFactoryKitAction['payload'],
    proof: ReturnType<Admission['start']> | undefined
): HandlerExecutionResult {
    const expected = { deviceState: before, parameterValues: {} };
    const next = { deviceState: after, parameterValues: {} };
    let validationTransferred = false;
    try {
        if (!applyDevicePatchState({ deviceId, expected, next }) || (proof && !proof.captureWrittenState(next))) {
            return { status: 'conflict' };
        }
        const transition = projectTransitionEpoch.captureEditAuthority();
        const reconcile = (): void => {
            if (transition.isCurrent()) {
                reconcileToasterKitFromProject(deviceId, { committedReplacement: true });
            }
        };
        validationTransferred = true;
        return {
            status: 'written',
            commitValidation: proof?.validation,
            afterCommit: reconcile,
            afterAmbiguousCommit: reconcile,
        };
    } finally {
        if (!validationTransferred) {
            proof?.validation.release();
        }
    }
}

export const handleSetToasterFactoryKit = createHandler<'setToasterFactoryKit'>({
    validate: (action, context) =>
        validToasterFactoryKitCapture(action.payload) &&
        supportedBatch(action, context) &&
        guardsMatch(action, context) &&
        admit(action, context),
    canReapplyAfterDivergence: (action, context) =>
        validToasterFactoryKitCapture(action.payload) &&
        supportedBatch(action, context) &&
        guardsMatch(action, context),
    execute: (action, context) => {
        const admission = admissions.get(action);
        admissions.delete(action);
        if (!validToasterFactoryKitCapture(action.payload) || !guardsMatch(action)) {
            return { status: 'conflict' };
        }
        const preview = context?.executionMode === 'isolated-preview';
        const proof = preview ? null : admission?.start();
        if (!preview && !proof) {
            return { status: 'conflict' };
        }
        return writeKitChunk(action.payload, proof);
    },
    describe: (action, context) => {
        // Single-action replay calls describe before execution without running validate.
        if (validToasterFactoryKitCapture(action.payload)) {
            admit(action, context);
        }
        return {
            label: action.payload.label,
            inverseAction: invertToasterFactoryKitAction(action),
            redoAction: action,
        };
    },
    isNoop: (action) =>
        validToasterFactoryKitCapture(action.payload) &&
        valuesEqual(action.payload.before, action.payload.after) &&
        guardsMatch(action),
    validateSessionActionArguments: validToasterFactoryKitCapture,
    validateSessionEntry: isToasterFactoryKitSessionEntry,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    canReportConflict: true,
    undoable: true,
});
