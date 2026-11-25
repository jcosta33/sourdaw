import { quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { type CrustPatch } from '../../models/CrustPatch';
import { CRUST_PRESET_PARAMETER_ORDER } from '../../models/CrustPresetParameterOrder';

import { encodeCrustValue } from './helpers';

export function encodeCrustPresetParameters(patch: CrustPatch): Record<string, number> | null {
    const parameters: Record<string, number> = {};
    for (const key of CRUST_PRESET_PARAMETER_ORDER) {
        const input =
            key === 'oversampling'
                ? quantiseDeviceParameterValue({ deviceType: 'crust', paramId: key, value: patch.oversampling })
                : patch[key];
        const value = encodeCrustValue(key, input);
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return null;
        }
        parameters[key] = value;
    }
    return parameters;
}
