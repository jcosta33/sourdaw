import {
    DEFAULT_MACRO_MAPPINGS,
    DEFAULT_PATCH,
    type FermenterMacroMapping,
    type FermenterMacroTarget,
    type FermenterPatch,
} from '../../models/FermenterPatch';
import { readUserPatchesText } from '../../repositories/user-patches/read-user-patches-text';

type JsonObject = {
    [key: string]: unknown;
};

type UserPatch = {
    id: string;
    name: string;
    patch: FermenterPatch;
};

function isJsonObject(value: unknown): value is JsonObject {
    if (typeof value !== 'object') {
        return false;
    }

    if (value === null) {
        return false;
    }

    return !Array.isArray(value);
}

function isMacroTuple(value: unknown): value is FermenterPatch['macros'] {
    if (!Array.isArray(value)) {
        return false;
    }

    if (value.length !== 8) {
        return false;
    }

    for (const entry of value) {
        if (typeof entry !== 'number') {
            return false;
        }

        if (!Number.isFinite(entry)) {
            return false;
        }
    }

    return true;
}

function isFiniteNumber(value: unknown): value is number {
    if (typeof value !== 'number') {
        return false;
    }

    return Number.isFinite(value);
}

const NUMERIC_PATCH_KEYS = new Set(
    Object.entries(DEFAULT_PATCH)
        .filter(([, value]) => typeof value === 'number')
        .map(([key]) => key)
);

function isNumericPatchKey(value: unknown): value is keyof FermenterPatch {
    if (typeof value !== 'string') {
        return false;
    }

    return NUMERIC_PATCH_KEYS.has(value);
}

function isMacroCurve(value: unknown): value is FermenterMacroTarget['curve'] {
    return value === 'linear' || value === 'exponential';
}

function cloneMacros(macros: FermenterPatch['macros']): FermenterPatch['macros'] {
    return [macros[0], macros[1], macros[2], macros[3], macros[4], macros[5], macros[6], macros[7]];
}

function cloneMacroMappings(macroMappings: FermenterMacroMapping[]): FermenterMacroMapping[] {
    return macroMappings.map((macroMapping) => ({
        targets: macroMapping.targets.map((target) => ({ ...target })),
    }));
}

function sanitizeMacroTarget(value: unknown): FermenterMacroTarget | null {
    if (!isJsonObject(value)) {
        return null;
    }

    if (!isNumericPatchKey(value.target)) {
        return null;
    }

    if (!isFiniteNumber(value.center)) {
        return null;
    }

    if (!isFiniteNumber(value.depth)) {
        return null;
    }

    if (!isFiniteNumber(value.min)) {
        return null;
    }

    if (!isFiniteNumber(value.max)) {
        return null;
    }

    if (!isMacroCurve(value.curve)) {
        return null;
    }

    return {
        target: value.target,
        center: value.center,
        depth: value.depth,
        min: value.min,
        max: value.max,
        curve: value.curve,
    };
}

function sanitizeMacroMapping(value: unknown): FermenterMacroMapping | null {
    if (!isJsonObject(value)) {
        return null;
    }

    if (!Array.isArray(value.targets)) {
        return null;
    }

    const targets: FermenterMacroTarget[] = [];
    for (const target of value.targets) {
        const sanitizedTarget = sanitizeMacroTarget(target);
        if (sanitizedTarget === null) {
            return null;
        }

        targets.push(sanitizedTarget);
    }

    return { targets };
}

function sanitizeMacroMappings(value: unknown): FermenterMacroMapping[] {
    if (!Array.isArray(value)) {
        return cloneMacroMappings(DEFAULT_MACRO_MAPPINGS);
    }

    if (value.length !== 8) {
        return cloneMacroMappings(DEFAULT_MACRO_MAPPINGS);
    }

    const macroMappings: FermenterMacroMapping[] = [];
    for (const macroMapping of value) {
        const sanitizedMacroMapping = sanitizeMacroMapping(macroMapping);
        if (sanitizedMacroMapping === null) {
            return cloneMacroMappings(DEFAULT_MACRO_MAPPINGS);
        }

        macroMappings.push(sanitizedMacroMapping);
    }

    return macroMappings;
}

type HydratePatchInput = {
    name: string;
    storedPatch: JsonObject;
};

function hydratePatch({ name, storedPatch }: HydratePatchInput): FermenterPatch {
    const patch: FermenterPatch = {
        ...DEFAULT_PATCH,
        name,
        macros: cloneMacros(DEFAULT_PATCH.macros),
        macroMappings: cloneMacroMappings(DEFAULT_MACRO_MAPPINGS),
    };

    for (const [key, defaultValue] of Object.entries(DEFAULT_PATCH)) {
        if (typeof defaultValue !== 'number') {
            continue;
        }

        const storedValue = storedPatch[key];
        if (typeof storedValue !== 'number') {
            continue;
        }

        if (!Number.isFinite(storedValue)) {
            continue;
        }

        Object.assign(patch, { [key]: storedValue });
    }

    if (isMacroTuple(storedPatch.macros)) {
        patch.macros = cloneMacros(storedPatch.macros);
    }

    patch.macroMappings = sanitizeMacroMappings(storedPatch.macroMappings);
    patch.name = name;
    return patch;
}

function sanitizeUserPatchRow(row: unknown): UserPatch | null {
    if (!isJsonObject(row)) {
        return null;
    }

    if (typeof row.id !== 'string') {
        return null;
    }

    if (typeof row.name !== 'string') {
        return null;
    }

    if (!isJsonObject(row.patch)) {
        return null;
    }

    return {
        id: row.id,
        name: row.name,
        patch: hydratePatch({ name: row.name, storedPatch: row.patch }),
    };
}

type LoadUserPatchesOutput = UserPatch[];

export function loadUserPatches(): LoadUserPatchesOutput {
    const stored = readUserPatchesText();
    if (stored === null) {
        return [];
    }

    try {
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed)) {
            return [];
        }

        const userPatches: UserPatch[] = [];
        for (const row of parsed) {
            const userPatch = sanitizeUserPatchRow(row);
            if (userPatch !== null) {
                userPatches.push(userPatch);
            }
        }

        return userPatches;
    } catch {
        return [];
    }
}
