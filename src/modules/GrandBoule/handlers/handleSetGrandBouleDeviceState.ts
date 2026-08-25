import { trackStore } from '#/modules/Arrangement/stores';
import { setDeviceState } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

import {
    fromGrandBouleDeviceState,
    readGrandBouleMorphState,
    toGrandBouleDeviceState,
} from '../models/GrandBouleDeviceState';
import { reconcileGrandBouleDeviceStateFromProject } from '../useCases/reconcileGrandBouleDeviceStateFromProject';

function currentState(deviceId: string): ReturnType<typeof toGrandBouleDeviceState> | null {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'grand-boule');
    return device === undefined ? null : toGrandBouleDeviceState(readGrandBouleMorphState(device.deviceState));
}

function canonicalState(state: unknown): ReturnType<typeof toGrandBouleDeviceState> | null {
    const morph = fromGrandBouleDeviceState(state);
    return morph === null ? null : toGrandBouleDeviceState(morph);
}

function statesEqual(left: unknown, right: unknown): boolean {
    const canonicalLeft = canonicalState(left);
    const canonicalRight = canonicalState(right);
    return (
        canonicalLeft !== null &&
        canonicalRight !== null &&
        JSON.stringify(canonicalLeft) === JSON.stringify(canonicalRight)
    );
}

export const handleSetGrandBouleDeviceState = createHandler<'setGrandBouleDeviceState'>({
    execute: (action) => {
        const before = canonicalState(action.payload.before);
        const after = canonicalState(action.payload.after);
        const current = currentState(action.payload.deviceId);
        if (before === null || after === null || current === null || !statesEqual(current, before)) {
            return { status: 'conflict' };
        }
        if (!setDeviceState({ deviceId: action.payload.deviceId, state: after })) {
            return { status: 'no-write' };
        }
        const reconcile = (): void => reconcileGrandBouleDeviceStateFromProject(action.payload.deviceId);
        return { status: 'written', afterCommit: reconcile, afterAmbiguousCommit: reconcile };
    },
    describe: (action) => ({
        label: 'Change Grand Boule voicing',
        inverseAction: {
            type: 'setGrandBouleDeviceState',
            payload: {
                deviceId: action.payload.deviceId,
                before: action.payload.after,
                after: action.payload.before,
            },
        },
        redoAction: action,
    }),
    isNoop: (action) => {
        const current = currentState(action.payload.deviceId);
        return current !== null && statesEqual(current, action.payload.after);
    },
    undoable: true,
});
