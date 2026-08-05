import { describe, expect, it } from 'vitest';

import { getPluginById } from '#/modules/Arrangement/useCases';

import { CRUST_OVERSAMPLE_FACTORS, DEFAULT_CRUST_PATCH } from '../CrustPatch';

describe('CRUST_OVERSAMPLE_FACTORS', () => {
    it('is the same set the Arrangement descriptor declares legal', () => {
        // The set is declared twice on purpose — models do not cross module
        // boundaries, so `PluginDescriptors/CrustDescriptor.ts` inlines its own
        // copy for the generic Device Inspector while the panel reads this one.
        // Deliberate duplication still drifts: the panel's copy and this type
        // were both missing 2x while the Rust cascade built a stage for it.
        // This is the join that makes a one-sided edit fail.
        const declared = getPluginById('crust')?.parameters.find((parameter) => parameter.id === 'oversampling');
        expect(declared?.legalValues, 'crust/oversampling declares no legal set').toBeDefined();
        expect([...(declared?.legalValues ?? [])]).toEqual([...CRUST_OVERSAMPLE_FACTORS]);
    });

    it('contains the factor the init patch boots at', () => {
        // Otherwise Crust opens on a setting neither its own panel nor the
        // Inspector select can offer, and the first click on either moves it
        // somewhere the user did not ask for.
        expect(CRUST_OVERSAMPLE_FACTORS).toContain(DEFAULT_CRUST_PATCH.oversampling);
    });
});
