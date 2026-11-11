import {
    DEFAULT_PATCH,
    type FermenterMacroMapping,
    type FermenterMacroTarget,
    type FermenterPatch,
} from './FermenterPatch';

export const FERMENTER_DEVICE_STATE_VERSION = 1;

type DeviceStateValue = string | number | boolean | null | DeviceStateValue[] | { [key: string]: DeviceStateValue };

export type FermenterDeviceStateChunk = {
    version: number;
    data: { [key: string]: DeviceStateValue };
};

type ProjectDevice = {
    parameterValues: Record<string, number>;
    deviceState?: unknown;
};

const NUMERIC_PATCH_KEYS = Object.entries(DEFAULT_PATCH)
    .filter(([, value]) => typeof value === 'number')
    .map(([key]) => key) as (keyof FermenterPatch)[];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function cloneMacros(macros: FermenterPatch['macros']): FermenterPatch['macros'] {
    return [macros[0], macros[1], macros[2], macros[3], macros[4], macros[5], macros[6], macros[7]];
}

function cloneMacroMappings(macroMappings: FermenterMacroMapping[] | undefined): FermenterMacroMapping[] | undefined {
    return macroMappings?.map((mapping) => ({
        targets: mapping.targets.map((target) => ({
            target: target.target,
            center: target.center,
            depth: target.depth,
            min: target.min,
            max: target.max,
            curve: target.curve,
        })),
    }));
}

export function cloneFermenterPatch(patch: FermenterPatch): FermenterPatch {
    return {
        ...patch,
        macros: cloneMacros(patch.macros),
        macroMappings: cloneMacroMappings(patch.macroMappings),
    };
}

function decodeMacros(value: unknown): FermenterPatch['macros'] | null {
    if (!Array.isArray(value) || value.length !== 8 || !value.every(isFiniteNumber)) {
        return null;
    }
    return [value[0]!, value[1]!, value[2]!, value[3]!, value[4]!, value[5]!, value[6]!, value[7]!];
}

function decodeMacroTarget(value: unknown): FermenterMacroTarget | null {
    if (!isRecord(value)) {
        return null;
    }
    const target = NUMERIC_PATCH_KEYS.find((key) => key === value.target);
    if (
        target === undefined ||
        !isFiniteNumber(value.center) ||
        !isFiniteNumber(value.depth) ||
        !isFiniteNumber(value.min) ||
        !isFiniteNumber(value.max) ||
        (value.curve !== 'linear' && value.curve !== 'exponential')
    ) {
        return null;
    }
    return {
        target,
        center: value.center,
        depth: value.depth,
        min: value.min,
        max: value.max,
        curve: value.curve,
    };
}

function decodeMacroMappings(value: unknown): FermenterMacroMapping[] | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value) || value.length !== 8) {
        return null;
    }
    const mappings: FermenterMacroMapping[] = [];
    for (const candidate of value) {
        if (!isRecord(candidate) || !Array.isArray(candidate.targets)) {
            return null;
        }
        const targets: FermenterMacroTarget[] = [];
        for (const target of candidate.targets) {
            const decoded = decodeMacroTarget(target);
            if (!decoded) {
                return null;
            }
            targets.push(decoded);
        }
        mappings.push({ targets });
    }
    return mappings;
}

function decodePatch(value: unknown): FermenterPatch | null {
    if (!isRecord(value) || value.version !== DEFAULT_PATCH.version || typeof value.name !== 'string') {
        return null;
    }
    const macros = decodeMacros(value.macros);
    const macroMappings = decodeMacroMappings(value.macroMappings);
    if (!macros || macroMappings === null) {
        return null;
    }
    const patch = cloneFermenterPatch({ ...DEFAULT_PATCH, name: value.name, macros, macroMappings });
    for (const key of NUMERIC_PATCH_KEYS) {
        const stored = value[key];
        if (!isFiniteNumber(stored)) {
            return null;
        }
        Object.assign(patch, { [key]: stored });
    }
    return patch;
}

export function toFermenterDeviceState(patch: FermenterPatch): FermenterDeviceStateChunk {
    const snapshot: { [key: string]: DeviceStateValue } = {
        version: patch.version,
        name: patch.name,
        macros: cloneMacros(patch.macros),
    };
    for (const key of NUMERIC_PATCH_KEYS) {
        const value = patch[key];
        if (typeof value === 'number') {
            snapshot[key] = value;
        }
    }
    if (patch.macroMappings) {
        snapshot.macroMappings = patch.macroMappings.map((mapping) => ({
            targets: mapping.targets.map((target) => ({
                target: target.target,
                center: target.center,
                depth: target.depth,
                min: target.min,
                max: target.max,
                curve: target.curve,
            })),
        }));
    }
    return { version: FERMENTER_DEVICE_STATE_VERSION, data: { patch: snapshot } };
}

export function fromFermenterDeviceState(chunk: unknown): FermenterPatch | null {
    if (!isRecord(chunk) || chunk.version !== FERMENTER_DEVICE_STATE_VERSION || !isRecord(chunk.data)) {
        return null;
    }
    return decodePatch(chunk.data.patch);
}

export function fermenterPatchesEqual(left: FermenterPatch, right: FermenterPatch): boolean {
    return JSON.stringify(toFermenterDeviceState(left)) === JSON.stringify(toFermenterDeviceState(right));
}

/** Read the audible project patch: the whole snapshot, overlaid by continuous numeric writes. */
export function readFermenterPatchFromProjectDevice(device: ProjectDevice): FermenterPatch {
    const patch = fromFermenterDeviceState(device.deviceState) ?? cloneFermenterPatch(DEFAULT_PATCH);
    for (const key of NUMERIC_PATCH_KEYS) {
        const value = device.parameterValues[key];
        if (isFiniteNumber(value)) {
            Object.assign(patch, { [key]: value });
        }
    }
    for (let index = 0; index < 8; index += 1) {
        const value = device.parameterValues[`macro${index}`];
        if (isFiniteNumber(value)) {
            patch.macros[index] = value;
        }
    }
    return patch;
}
