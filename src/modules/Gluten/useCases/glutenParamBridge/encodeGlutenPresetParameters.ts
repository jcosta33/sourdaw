import { clampOversampling, type GlutenPatch } from '../../models/GlutenPatch';
import { GLUTEN_PRESET_PARAMETER_ORDER } from '../../models/GlutenPresetParameterOrder';

import { encodeGlutenValue } from './helpers';

export function encodeGlutenPresetParameters(patch: GlutenPatch): Record<string, number> | null {
    const parameters: Record<string, number> = {};
    for (const key of GLUTEN_PRESET_PARAMETER_ORDER) {
        const rawValue = key === 'oversampling' ? clampOversampling(patch.oversampling) : patch[key];
        const value = encodeGlutenValue(key, rawValue);
        if (value === null || !Number.isFinite(value)) {
            return null;
        }
        parameters[key] = value;
    }
    return parameters;
}
