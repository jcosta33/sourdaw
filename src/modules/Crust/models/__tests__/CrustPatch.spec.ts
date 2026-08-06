import { describe, expect, it } from 'vitest';

import { getPluginById, quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { asCrustOversampleFactor, CRUST_OVERSAMPLE_FACTORS, DEFAULT_CRUST_PATCH } from '../CrustPatch';

describe('CRUST_OVERSAMPLE_FACTORS', () => {
    it('is the same set the Arrangement descriptor declares legal', () => {
        // The set is declared twice on purpose — models do not cross module
        // boundaries, so `PluginDescriptors/CrustDescriptor.ts` inlines its own
        // copy for the generic Device Inspector while the panel reads this one.
        // Deliberate duplication still drifts: the panel's copy and this type
        // were both missing 2x while the Rust cascade built a stage for it.
        // This is the join that makes a one-sided edit fail.
        const declared = getPluginById('crust')?.parameters.find((parameter) => parameter.id === 'oversampling');
        expect(declared?.legalSet?.resolution, 'crust/oversampling declares no legal set').toBe('floor');
        expect([...(declared?.legalSet?.values ?? [])]).toEqual([...CRUST_OVERSAMPLE_FACTORS]);
    });

    it('contains the factor the init patch boots at', () => {
        // Otherwise Crust opens on a setting neither its own panel nor the
        // Inspector select can offer, and the first click on either moves it
        // somewhere the user did not ask for.
        expect(CRUST_OVERSAMPLE_FACTORS).toContain(DEFAULT_CRUST_PATCH.oversampling);
    });
});

describe('asCrustOversampleFactor', () => {
    it('narrows a declared factor and refuses everything else', () => {
        expect(asCrustOversampleFactor(2)).toBe(2);
        expect(asCrustOversampleFactor(32)).toBe(32);
        // 20 and 30 are both reachable in stored data — the pre-declaration
        // Inspector knob stepped by 1 over 1..32 — and neither is a factor.
        expect(asCrustOversampleFactor(20)).toBeNull();
        expect(asCrustOversampleFactor(30)).toBeNull();
        expect(asCrustOversampleFactor(0)).toBeNull();
    });

    it('never refuses what the delivery law hands it, anywhere in the declared range', () => {
        // This is what lets `loadCrustPatchWithAudio` treat `null` as "leave the
        // value alone" instead of substituting a default it made up: the null
        // branch is unreachable in production, and this is the proof rather than
        // the assumption. It reds if the descriptor's legal set and
        // CRUST_OVERSAMPLE_FACTORS ever stop being the same set.
        const declared = getPluginById('crust')?.parameters.find((parameter) => parameter.id === 'oversampling');
        expect(declared, 'crust/oversampling is not in the plugin registry').toBeDefined();

        const refused: number[] = [];
        for (let value = declared!.minValue; value <= declared!.maxValue; value += 1) {
            const delivered = quantiseDeviceParameterValue({
                deviceType: 'crust',
                paramId: 'oversampling',
                value,
            });
            if (asCrustOversampleFactor(delivered) === null) {
                refused.push(value);
            }
        }

        expect(refused).toEqual([]);
    });
});
