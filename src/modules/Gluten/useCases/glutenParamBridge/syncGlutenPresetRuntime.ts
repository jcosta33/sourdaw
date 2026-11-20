import { DEFAULT_PATCH } from '../../models/GlutenPatch';
import { GLUTEN_PRESET_PARAMETER_ORDER } from '../../models/GlutenPresetParameterOrder';

import { bridgeDeps, encodeGlutenValue, paramBatcher } from './helpers';
import { hydrateGlutenPatchFromProject } from './hydrateGlutenPatchFromProject';

export function syncGlutenPresetRuntime(
    trackId: string,
    deviceId: string,
    parameters: Readonly<Record<string, number | null>>,
    name: string
): void {
    hydrateGlutenPatchFromProject(deviceId, name);
    for (const key of GLUTEN_PRESET_PARAMETER_ORDER) {
        paramBatcher.cancel(`${deviceId}:${key}`);
        const value = parameters[key] ?? encodeGlutenValue(key, DEFAULT_PATCH[key]);
        if (value === null) {
            throw new Error(`Gluten has no encoded default for ${key}`);
        }
        bridgeDeps.updateDeviceParam(trackId, deviceId, key, value);
    }
}
