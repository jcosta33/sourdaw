import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import {
    applyDevicePatchState,
    captureDevicePatchCommitValidation,
    getDevicePatchOwnerIncarnation,
    getPlannedDevicePatchState,
} from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { type HandlerDeviceOwnerChange, type HandlerMaterializationContext } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type GrinderFactoryPresetAction } from '../events/grinderAppActions';
import { grinderFactoryPresetRuntimePort } from '../useCases/grinderFactoryPresetRuntimePort';

import {
    invertGrinderFactoryPresetAction,
    isGrinderFactoryPresetSessionEntry,
    validGrinderFactoryPresetCapture,
} from './grinderFactoryPresetCapture';

type Action = GrinderFactoryPresetAction;
type Admission = NonNullable<ReturnType<typeof captureDevicePatchCommitValidation>>;
const admissions = new WeakMap<Action, Admission>();
const replayInverses = new WeakSet<Action>();
const admittedInverses = new WeakSet<Action>();

function readOwner(payload: Action['payload']) {
    const target = resolveEligibleDeviceWriteTarget(payload.deviceId);
    if (target.status !== 'eligible' || target.trackId !== payload.trackId) {
        return null;
    }
    const owner = getPlannedDevicePatchState({
        trackId: payload.trackId,
        deviceId: payload.deviceId,
        parameterIds: Object.keys(payload.before),
    });
    return owner &&
        owner.deviceType === 'grinder' &&
        !owner.frozen &&
        valuesEqual(owner.deviceIds, payload.deviceIds) &&
        valuesEqual(getDevicePatchOwnerIncarnation(payload), payload.ownerIncarnation)
        ? owner
        : null;
}

function matchesSource(payload: Action['payload']): boolean {
    const owner = readOwner(payload);
    return (
        owner !== null &&
        valuesEqual(owner.state.parameterValues, payload.direction === 'undo' ? payload.after : payload.before)
    );
}

function materialize(action: Action, context?: HandlerMaterializationContext): void {
    if (action.payload.direction !== 'undo' || context?.undoEntryId === undefined) {
        return;
    }
    const requested = context.actions[context.actionIndex];
    if (requested?.type === action.type && replayInverses.has(requested) && valuesEqual(requested, action)) {
        admittedInverses.add(action);
    }
}

function isAuthorizedReplay(action: Action): boolean {
    return action.payload.direction !== 'undo' || admittedInverses.has(action);
}

function rebindDeviceOwner(action: Action, owner: HandlerDeviceOwnerChange): Action {
    const { payload } = action;
    if (
        payload.trackId !== owner.trackId ||
        payload.deviceId !== owner.deviceId ||
        !valuesEqual(payload.ownerIncarnation, owner.previous)
    ) {
        return action;
    }
    const rebound = { ...action, payload: { ...payload, ownerIncarnation: owner.current } };
    if (replayInverses.has(action)) {
        replayInverses.add(rebound);
    }
    return rebound;
}

export const handleSetGrinderFactoryPreset = createHandler<'setGrinderFactoryPreset'>({
    materializeCommandArguments: materialize,
    validate: ({ payload }) => validGrinderFactoryPresetCapture(payload) && matchesSource(payload),
    describe: (action) => {
        admissions.delete(action);
        if (
            validGrinderFactoryPresetCapture(action.payload) &&
            matchesSource(action.payload) &&
            isAuthorizedReplay(action)
        ) {
            const admission = captureDevicePatchCommitValidation({
                trackId: action.payload.trackId,
                deviceId: action.payload.deviceId,
                parameterIds: Object.keys(action.payload.before),
                requireCurrentProjection: true,
            });
            if (
                admission &&
                valuesEqual(getDevicePatchOwnerIncarnation(action.payload), action.payload.ownerIncarnation)
            ) {
                admissions.set(action, admission);
            }
        }
        if (action.payload.direction === 'undo') {
            return { label: 'Load Rectifier Heavy' };
        }
        const inverseAction = invertGrinderFactoryPresetAction(action);
        replayInverses.add(inverseAction);
        return { label: 'Load Rectifier Heavy', inverseAction, redoAction: action };
    },
    execute: (action) => {
        const admission = admissions.get(action);
        admissions.delete(action);
        const { payload } = action;
        const owner = validGrinderFactoryPresetCapture(payload) ? readOwner(payload) : null;
        if (!admission) {
            return { status: 'conflict', reason: 'Grinder preset admission was unavailable.' };
        }
        if (!owner) {
            return { status: 'conflict', reason: 'Grinder preset owner changed.' };
        }
        if (!matchesSource(payload)) {
            return { status: 'conflict', reason: 'Grinder preset source changed.' };
        }
        if (!isAuthorizedReplay(action)) {
            return { status: 'conflict', reason: 'Grinder preset inverse was not authorized.' };
        }
        const proof = admission.start();
        if (!proof) {
            return { status: 'conflict', reason: 'Grinder preset commit observation could not start.' };
        }
        const parameters = payload.direction === 'undo' ? payload.before : payload.after;
        const next = { deviceState: owner.state.deviceState, parameterValues: parameters };
        let transferred = false;
        try {
            if (
                !applyDevicePatchState({
                    deviceId: payload.deviceId,
                    expected: owner.state,
                    next,
                    mode: payload.direction === 'undo' ? 'restore-captured' : 'authored',
                })
            ) {
                return { status: 'conflict', reason: 'Grinder preset source changed during projection.' };
            }
            if (!proof.captureWrittenState(next)) {
                return { status: 'conflict', reason: 'Grinder preset written projection did not match.' };
            }
            const sync = (): void => {
                const committed = readOwner(payload);
                if (
                    committed &&
                    valuesEqual(committed.state.parameterValues, parameters) &&
                    admission.matchesCommittedParameters(parameters)
                ) {
                    grinderFactoryPresetRuntimePort.publish(payload);
                }
            };
            transferred = true;
            return {
                status: 'written',
                commitValidation: proof.validation,
                afterCommit: sync,
                afterAmbiguousCommit: sync,
            };
        } finally {
            if (!transferred) {
                proof.validation.release();
            }
        }
    },
    isNoop: ({ payload }) =>
        payload.direction === undefined &&
        validGrinderFactoryPresetCapture(payload) &&
        valuesEqual(payload.before, payload.after) &&
        matchesSource(payload),
    validateSessionActionArguments: validGrinderFactoryPresetCapture,
    validateSessionEntry: isGrinderFactoryPresetSessionEntry,
    restoreSessionEntry: (entry) => {
        if (entry.inverseAction?.type === 'setGrinderFactoryPreset' && isGrinderFactoryPresetSessionEntry(entry)) {
            replayInverses.add(entry.inverseAction);
        }
    },
    rebindDeviceOwner,
    batchExecution: 'singleton',
    previewExecution: 'unsupported-external',
    requiresAbortCompensation: false,
    canReportConflict: true,
    undoable: true,
});
