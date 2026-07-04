import { DEFAULT_PATCH, type FermenterPatch } from '../../models/FermenterPatch';
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

function cloneMacros(macros: FermenterPatch['macros']): FermenterPatch['macros'] {
    return [macros[0], macros[1], macros[2], macros[3], macros[4], macros[5], macros[6], macros[7]];
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
