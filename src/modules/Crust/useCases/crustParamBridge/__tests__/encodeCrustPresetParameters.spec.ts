import { describe, expect, it } from 'vitest';

import { CRUST_OVERSAMPLE_FACTORS, DEFAULT_CRUST_PATCH } from '../../../models/CrustPatch';
import { CRUST_PRESET_PARAMETER_ORDER } from '../../../models/CrustPresetParameterOrder';
import { CRUST_PRESETS } from '../../crustPresets';
import { encodeCrustPresetParameters } from '../encodeCrustPresetParameters';

describe('encodeCrustPresetParameters', () => {
    it('encodes all 27 engine parameters for every factory preset', () => {
        for (const preset of CRUST_PRESETS) {
            const encoded = encodeCrustPresetParameters(preset.patch);

            expect(encoded, preset.id).not.toBeNull();
            expect(Object.keys(encoded!), preset.id).toEqual([...CRUST_PRESET_PARAMETER_ORDER]);
            expect(Object.values(encoded!).every(Number.isFinite), preset.id).toBe(true);
        }
    });

    it('floors an invalid oversampling factor through the Arrangement descriptor law', () => {
        const patch = { ...DEFAULT_CRUST_PATCH, oversampling: 20 };
        const encoded = encodeCrustPresetParameters(patch);

        expect(encoded?.oversampling).toBe(16);
        expect(CRUST_OVERSAMPLE_FACTORS).toContain(encoded?.oversampling);
    });
});
