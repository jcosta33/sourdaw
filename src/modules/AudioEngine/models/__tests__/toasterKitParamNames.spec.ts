import { describe, expect, it } from 'vitest';

import { mapToasterKitParamToDspParam, TOASTER_KIT_PARAM_NAMES } from '../ToasterKitParamNames';

/**
 * `builtin_named_parameter` (`crates/sourdaw-native/src/commands/graph.rs`)
 * refuses a key that is not lowercase ASCII, digits and underscores, and that
 * refusal takes the whole `write-device-parameter` batch with it. Restated
 * rather than imported from `nativeBuiltinBodies.ts`: domain models must not
 * import `useCases` (`no-models-repos-transformers-in-index`), the same reason
 * `grandBouleDspParamNames.spec.ts` restates it instead of importing
 * `BUILTIN_PARAM_NAME_SHAPE`.
 */
const ENGINE_PARAM_NAME_SHAPE = /^[a-z0-9_]{1,32}$/;

describe('Toaster kit DSP parameter names', () => {
    it('produces only names the engine parameter carrier admits', () => {
        for (const name of Object.values(TOASTER_KIT_PARAM_NAMES)) {
            expect(name).toMatch(ENGINE_PARAM_NAME_SHAPE);
        }
    });

    // The four ids `TOASTER_DESCRIPTOR` declares automatable — the only ids
    // `device.parameterValues` ever actually holds for a Toaster.
    it('resolves every descriptor id the panel and a lane can author', () => {
        expect(mapToasterKitParamToDspParam({ paramId: 'masterGain' })).toBe('master_gain');
        expect(mapToasterKitParamToDspParam({ paramId: 'reverbMix' })).toBe('reverb_mix');
        expect(mapToasterKitParamToDspParam({ paramId: 'delayMix' })).toBe('delay_mix');
        expect(mapToasterKitParamToDspParam({ paramId: 'swing' })).toBe('swing');
    });

    it('refuses the engine spelling or an id the kit does not carry', () => {
        expect(mapToasterKitParamToDspParam({ paramId: 'master_gain' })).toBeNull();
        expect(mapToasterKitParamToDspParam({ paramId: 'bogus' })).toBeNull();
    });
});
