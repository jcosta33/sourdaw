import { describe, expect, it } from 'vitest';

import { getPluginById } from '#/modules/Arrangement/useCases';

import { CRUST_DSP_PARAM_NAMES, mapCrustParamToDspParam } from '../CrustDspParamNames';

/**
 * Crust's two hosts spell one limiter's parameters, and this is the table they
 * share.
 *
 * The worklet posts `set_param` under these names and the native body hands the
 * same name to the same engine, so a descriptor id missing from the table is a
 * parameter that does nothing on both transports — silently, because
 * `set_param` ignores a name it does not know rather than refusing it.
 */
describe('Crust DSP parameter names', () => {
    it('names every parameter the descriptor declares', () => {
        const descriptor = getPluginById('crust');
        if (descriptor === undefined) {
            throw new Error("no builtin descriptor for 'crust'");
        }

        expect(descriptor.parameters.length).toBeGreaterThan(0);
        for (const parameter of descriptor.parameters) {
            expect(mapCrustParamToDspParam({ paramId: parameter.id })).not.toBeNull();
        }
    });

    /**
     * `builtin_named_parameter` (`crates/sourdaw-native/src/commands/graph.rs`)
     * refuses a key that is not lowercase ASCII, digits and underscores, and
     * that refusal takes the whole chain mapping with it. Every name this table
     * produces therefore has to satisfy the shape before it is ever sent.
     */
    it('produces only names the engine parameter carrier admits', () => {
        for (const name of Object.values(CRUST_DSP_PARAM_NAMES)) {
            expect(name).toMatch(/^[a-z0-9_]{1,32}$/);
        }
    });

    // The limiter is addressed in camelCase and answers in snake_case, so the
    // engine's own spelling of a parameter is not a project id and must not
    // resolve — admitting it would let a lane author a name the body then hands
    // through unchanged, bypassing this table.
    it('resolves a project id, and refuses the engine spelling or an unknown id', () => {
        expect(mapCrustParamToDspParam({ paramId: 'attackAuto' })).toBe('attack_auto');
        expect(mapCrustParamToDspParam({ paramId: 'attack_auto' })).toBeNull();
        expect(mapCrustParamToDspParam({ paramId: 'bogus' })).toBeNull();
    });
});
