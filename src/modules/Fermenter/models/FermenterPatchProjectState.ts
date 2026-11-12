import { valuesEqual } from '#/utils/structuralEquality';

import { DEFAULT_PATCH, type FermenterPatch } from './FermenterPatch';
import {
    type FermenterDeviceStateChunk,
    toFermenterDeviceState,
    readFermenterPatchFromProjectDevice,
    fermenterPatchesEqual,
    fromFermenterDeviceState,
} from './FermenterPatchState';

type Chunk = FermenterDeviceStateChunk;
type ProjectDevice = { deviceState?: Chunk; parameterValues: Record<string, number> };

export type FermenterPatchProjectState = {
    deviceState: Chunk | null;
    parameterValues: Record<string, number | null>;
};

const NUMERIC_KEYS = Object.entries(DEFAULT_PATCH).flatMap(([key, value]) => {
    if (typeof value !== 'number') {
        return [];
    }
    return [key];
});
const FOOTPRINT = [...NUMERIC_KEYS, ...Array.from({ length: 8 }, (_, index) => `macro${index}`)];

export function captureFermenterPatchProjectState(device: ProjectDevice): FermenterPatchProjectState {
    const parameterValues: Record<string, number | null> = {};
    for (const key of FOOTPRINT) {
        parameterValues[key] = Object.hasOwn(device.parameterValues, key) ? device.parameterValues[key]! : null;
    }
    return { deviceState: device.deviceState ? structuredClone(device.deviceState) : null, parameterValues };
}

/** Build a complete draft write while retaining unmodified scalar absence. */
export function projectFermenterPatchState(
    current: FermenterPatchProjectState,
    projectPatch: FermenterPatch,
    patch: FermenterPatch,
    clamp: (key: string, value: number) => number
): FermenterPatchProjectState {
    const parameterValues = { ...current.parameterValues };
    const previous = new Map(Object.entries(projectPatch));
    for (const [key, value] of Object.entries(patch)) {
        if (typeof value === 'number' && (parameterValues[key] !== null || previous.get(key) !== value)) {
            parameterValues[key] = clamp(key, value);
        }
    }
    const chunk = toFermenterDeviceState(patch);
    return {
        deviceState: { ...chunk, data: { ...current.deviceState?.data, ...chunk.data } },
        parameterValues,
    };
}

export function fermenterPatchProjectStatesEqual(
    left: FermenterPatchProjectState,
    right: FermenterPatchProjectState
): boolean {
    return valuesEqual(left, right);
}

export function readFermenterPatchProjectState(state: FermenterPatchProjectState): FermenterPatch {
    const parameterValues: Record<string, number> = {};
    for (const [key, value] of Object.entries(state.parameterValues)) {
        if (value !== null) {
            parameterValues[key] = value;
        }
    }
    return readFermenterPatchFromProjectDevice({ parameterValues, deviceState: state.deviceState ?? undefined });
}

export function fermenterProjectStateMatchesPatch(state: FermenterPatchProjectState, patch: FermenterPatch): boolean {
    const keys = Object.keys(state.parameterValues);
    return (
        (state.deviceState === null || fromFermenterDeviceState(state.deviceState) !== null) &&
        keys.length === FOOTPRINT.length &&
        FOOTPRINT.every((key) => Object.hasOwn(state.parameterValues, key)) &&
        Object.values(state.parameterValues).every((value) => value === null || Number.isFinite(value)) &&
        fermenterPatchesEqual(readFermenterPatchProjectState(state), patch)
    );
}
