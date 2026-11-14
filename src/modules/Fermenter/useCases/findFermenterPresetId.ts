import { type FermenterPatch } from '../models/FermenterPatch';
import { fermenterPatchesEqual } from '../models/FermenterPatchState';

import { resolveFermenterPresetPatch } from './fermenterPatchOperations';
import { FERMENTER_PRESETS } from './fermenterQueries/helpers';

/** Reopened panels recover preset context from sound state, never from a saved UI session. */
export function findFermenterPresetId(
    patch: FermenterPatch,
    userPatches: Array<{ id: string; name: string; patch: FermenterPatch }>
): string | null {
    for (const preset of [...userPatches, ...FERMENTER_PRESETS]) {
        const candidate = resolveFermenterPresetPatch(preset.id, userPatches);
        if (candidate && fermenterPatchesEqual(candidate, patch)) {
            return preset.id;
        }
    }
    return null;
}
