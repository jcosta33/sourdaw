import { trackStore } from '#/modules/Arrangement/stores';
import { setDeviceState } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import {
    fermenterPatchesEqual,
    fromFermenterDeviceState,
    readFermenterPatchFromProjectDevice,
    toFermenterDeviceState,
} from '../models/FermenterPatchState';
import { getFermenterDependencies } from '../useCases/getFermenterDependencies';
import { reconcileFermenterPatchFromProject } from '../useCases/reconcileFermenterPatchFromProject';

type PatchAction = Extract<AppAction, { type: 'setFermenterPatch' }>;

function currentTarget(action: PatchAction) {
    const owners = (trackStore.value?.tracks ?? []).filter((track) =>
        track.devices.some((device) => device.id === action.payload.deviceId)
    );
    const owner = owners.length === 1 ? owners[0] : undefined;
    const device = owner?.devices.find((candidate) => candidate.id === action.payload.deviceId);
    return { owner, device };
}

function guardsMatch(action: PatchAction): boolean {
    const { owner, device } = currentTarget(action);
    if (!owner || !device || device.type !== 'fermenter' || owner.frozen === true) {
        return false;
    }
    const currentDeviceIds = owner.devices.map((candidate) => candidate.id);
    if (
        owner.id !== action.payload.expectedTrackId ||
        owner.frozen !== action.payload.expectedTrackFrozen ||
        action.payload.expectedDeviceIds.length !== currentDeviceIds.length ||
        action.payload.expectedDeviceIds.some((deviceId, index) => currentDeviceIds[index] !== deviceId)
    ) {
        return false;
    }
    const expectedCurrent = fromFermenterDeviceState(action.payload.expectedCurrent);
    return (
        expectedCurrent !== null && fermenterPatchesEqual(readFermenterPatchFromProjectDevice(device), expectedCurrent)
    );
}

export const handleSetFermenterPatch = createHandler<'setFermenterPatch'>({
    validate: (action) =>
        fromFermenterDeviceState(action.payload.before) !== null &&
        fromFermenterDeviceState(action.payload.after) !== null &&
        guardsMatch(action),
    execute: (action) => {
        const before = fromFermenterDeviceState(action.payload.before);
        const after = fromFermenterDeviceState(action.payload.after);
        if (!before || !after || !guardsMatch(action)) {
            return { status: 'conflict' };
        }
        const { device } = currentTarget(action);
        if (!device) {
            return { status: 'conflict' };
        }
        const previousValues = new Map(Object.entries(readFermenterPatchFromProjectDevice(device)));
        if (!setDeviceState({ deviceId: action.payload.deviceId, state: toFermenterDeviceState(after) })) {
            return { status: 'no-write' };
        }
        // Scalar edits retain unrelated absent leaves. Existing mirrors still
        // follow the full snapshot, so hydration cannot overlay an older value.
        for (const [key, value] of Object.entries(after)) {
            if (typeof value !== 'number') {
                continue;
            }
            const changed = Object.hasOwn(device.parameterValues, key)
                ? device.parameterValues[key] !== value
                : previousValues.get(key) !== value;
            if (changed) {
                getFermenterDependencies().persistDeviceParam(action.payload.deviceId, key, value);
            }
        }
        const reconcile = (): void => reconcileFermenterPatchFromProject(action.payload.deviceId);
        return { status: 'written', afterCommit: reconcile, afterAmbiguousCommit: reconcile };
    },
    describe: (action) => ({
        label: action.payload.label,
        inverseAction: {
            type: 'setFermenterPatch',
            payload: {
                ...action.payload,
                before: action.payload.after,
                after: action.payload.before,
                expectedCurrent: action.payload.after,
            },
        },
        redoAction: {
            ...action,
            payload: { ...action.payload, expectedCurrent: action.payload.before },
        },
    }),
    isNoop: (action) => {
        const after = fromFermenterDeviceState(action.payload.after);
        const { device } = currentTarget(action);
        return (
            after !== null &&
            device?.type === 'fermenter' &&
            fermenterPatchesEqual(readFermenterPatchFromProjectDevice(device), after)
        );
    },
    undoable: true,
});
