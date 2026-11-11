import { trackStore } from '#/modules/Arrangement/stores';

import { DEFAULT_PATCH, type FermenterPatch } from '../models/FermenterPatch';
import { cloneFermenterPatch, fermenterPatchesEqual, fromFermenterDeviceState } from '../models/FermenterPatchState';
import { fermenterStore, loadFermenterPatch } from '../stores/fermenterStore';

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
 * Hydrate the Fermenter session state store from project truth. Whole-patch
 * snapshots restore names and nested mappings; numeric values remain the overlay
 * for continuous parameter and macro writes. Legacy projects retain their
 * original macro-seeding behaviour until their first whole-patch commit.
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
    const persistedPatch = fromFermenterDeviceState(device.deviceState);
    const isUnseeded = currentInstance === undefined;
    const patch = persistedPatch
        ? cloneFermenterPatch(persistedPatch)
        : {
              ...currentPatch,
              // Undo of a first discrete selection removes its leaf, restoring the default.
              oscEngine: Object.hasOwn(device.parameterValues ?? {}, 'oscEngine')
                  ? currentPatch.oscEngine
                  : DEFAULT_PATCH.oscEngine,
              filterModel: Object.hasOwn(device.parameterValues ?? {}, 'filterModel')
                  ? currentPatch.filterModel
                  : DEFAULT_PATCH.filterModel,
              filterMode: Object.hasOwn(device.parameterValues ?? {}, 'filterMode')
                  ? currentPatch.filterMode
                  : DEFAULT_PATCH.filterMode,
              macros: [...currentPatch.macros],
              macroMappings: currentPatch.macroMappings
                  ? currentPatch.macroMappings.map((mapping) => ({
                        targets: mapping.targets.map((target) => ({ ...target })),
                    }))
                  : undefined,
          };

    if (device.parameterValues) {
        applyParameterValues(patch, device.parameterValues, persistedPatch !== null || isUnseeded);
    }

    if (isUnseeded || !fermenterPatchesEqual(currentPatch, patch)) {
        loadFermenterPatch(deviceId, cloneFermenterPatch(patch));
    }
    return patch;
}
