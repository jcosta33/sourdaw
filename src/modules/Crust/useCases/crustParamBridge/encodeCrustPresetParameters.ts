import { quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { type CrustPatch } from '../../models/CrustPatch';
import { CRUST_PRESET_PARAMETER_ORDER } from '../../models/CrustPresetParameterOrder';

import { encodeCrustValue } from './helpers';

type EncodableCrustPatch = Omit<CrustPatch, 'oversampling'> & { oversampling: number };

export function encodeCrustPresetParameters(patch: EncodableCrustPatch): Record<string, number> | null {
    const parameters: Record<string, number> = {};
    for (const key of CRUST_PRESET_PARAMETER_ORDER) {
        let input = patch[key];
        if (key === 'oversampling') {
            input = quantiseDeviceParameterValue({ deviceType: 'crust', paramId: key, value: patch.oversampling });
        }
        const value = encodeCrustValue(key, input);
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return null;
        }
        parameters[key] = value;
    }
    return parameters;
}
