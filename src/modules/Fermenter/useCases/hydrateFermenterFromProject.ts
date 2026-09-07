import { trackStore } from '#/modules/Arrangement/stores';

import { DEFAULT_PATCH, type FermenterPatch } from '../models/FermenterPatch';
import { fermenterStore, loadFermenterPatch } from '../stores/fermenterStore';

function isPatchUnchanged(currentInstance: unknown, currentPatch: FermenterPatch, patch: FermenterPatch): boolean {
    if (currentInstance === undefined) {
        return false;
    }
    if (patch.name !== currentPatch.name) {
        return false;
    }
    if (!patch.macros.every((v, i) => v === currentPatch.macros[i])) {
        return false;
    }
    return (Object.keys(DEFAULT_PATCH) as (keyof FermenterPatch)[]).every((key) => {
        if (key === 'macros' || key === 'macroMappings') {
            return true;
        }
        return patch[key] === currentPatch[key];
    });
}

function applyParameterValues(
    patch: FermenterPatch,
    parameterValues: Record<string, number>,
    seedMacros: boolean
): void {
    for (const [key, value] of Object.entries(parameterValues)) {
        if (key === 'macros' || key === 'macroMappings' || key === 'name' || key === 'version') {
            continue;
        }
        if (key in patch && typeof value === 'number' && Number.isFinite(value)) {
            (patch as Record<string, unknown>)[key] = value;
        } else if (seedMacros && key.startsWith('macro') && typeof value === 'number' && Number.isFinite(value)) {
            const idx = parseInt(key.slice(5), 10);
            if (idx >= 0 && idx < 8) {
                patch.macros[idx] = value;
            }
        }
    }
}

/**
 * Hydrate the Fermenter session state store from project parameter values.
 *
 * Ensures that when a project is opened, the Fermenter panel displays the
 * persisted patch that the Web Audio synth engine is currently playing,
 * preventing defaults from overwriting the saved sound on knob adjustments.
 */
export function hydrateFermenterFromProject(deviceId: string): FermenterPatch | null {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return null;
    }

    const device = tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === deviceId);
    if (!device || device.type !== 'fermenter') {
        return null;
    }

    const currentInstance = (fermenterStore.value ?? {})[deviceId];
    const currentPatch = currentInstance?.patch ?? DEFAULT_PATCH;

    const patch: FermenterPatch = {
        ...currentPatch,
        macros: [...currentPatch.macros],
        macroMappings: currentPatch.macroMappings ? [...currentPatch.macroMappings] : undefined,
    };

    const isUnseeded = currentInstance === undefined;
    if (device.parameterValues) {
        applyParameterValues(patch, device.parameterValues, isUnseeded);
    }

    if (!isPatchUnchanged(currentInstance, currentPatch, patch)) {
        loadFermenterPatch(deviceId, patch);
    }
    return patch;
}
