import { DEFAULT_PATCH, type FermenterPatch } from '../models/FermenterPatch';
import { cloneFermenterPatch } from '../models/FermenterPatchState';

import { FERMENTER_PRESETS } from './fermenterQueries/helpers';

export function resolveFermenterPresetPatch(
    presetId: string,
    userPatches: Array<{ id: string; name: string; patch: FermenterPatch }>
): FermenterPatch | null {
    const userPatch = userPatches.find((patch) => patch.id === presetId);
    if (userPatch) {
        return cloneFermenterPatch(userPatch.patch);
    }

    const preset = FERMENTER_PRESETS.find((entry) => entry.id === presetId);
    const values = preset?.devices[0]?.parameterValues;
    if (!preset || !values) {
        return null;
    }

    const patch = cloneFermenterPatch({ ...DEFAULT_PATCH, name: preset.name });
    for (const [key, value] of Object.entries(values)) {
        if (key in patch && typeof value === 'number') {
            (patch as Record<string, unknown>)[key] = value;
        } else if (key.startsWith('macro') && typeof value === 'number') {
            const index = Number.parseInt(key.slice(5), 10);
            if (index >= 0 && index < 8) {
                patch.macros[index] = value;
            }
        }
    }
    return patch;
}
