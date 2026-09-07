import { describe, expect, it } from 'vitest';

import { PARAM_MAP } from '../../worklets/grandBouleEngineCore';
import { GRAND_BOULE_DSP_PARAM_NAMES, mapGrandBouleParamToDspParam } from '../GrandBouleDspParamNames';

/**
 * The two Grand Boule hosts spell one instrument's parameters, and this is the
 * weld between their tables.
 *
 * The worklet's `PARAM_MAP` is the web path's translation; the copy under test
 * is the native path's. They address the same `set_param` on the same engine, so
 * a name in one and not the other is a parameter that moves on one transport and
 * does nothing on the other — silently, because `set_param` ignores a name it
 * does not know rather than refusing it. Only a spec can catch that: `worklets/`
 * is isolated from the module runtime by `deps:validate`, so neither table can
 * be derived from the other.
 */
describe('Grand Boule DSP parameter names', () => {
    it('names every parameter the worklet names, and no other', () => {
        expect(GRAND_BOULE_DSP_PARAM_NAMES).toEqual(PARAM_MAP);
    });

    it('resolves an id the instrument addresses, and refuses one it does not', () => {
        expect(mapGrandBouleParamToDspParam({ paramId: 'masterGain' })).toBe('master_gain');
        expect(mapGrandBouleParamToDspParam({ paramId: 'hammerHardnessScale' })).toBe('hammer_hardness_scale');
        expect(mapGrandBouleParamToDspParam({ paramId: 'master_gain' })).toBeNull();
        expect(mapGrandBouleParamToDspParam({ paramId: 'bogus' })).toBeNull();
    });

    /**
     * `builtin_named_parameter` (`crates/sourdaw-native/src/commands/graph.rs`)
     * refuses a key that is not lowercase ASCII, digits and underscores, and
     * that refusal takes the whole `write-device-parameter` batch with it. Every
     * name this table produces therefore has to satisfy the shape before it is
     * ever sent.
     */
    it('produces only names the engine parameter carrier admits', () => {
        for (const name of Object.values(GRAND_BOULE_DSP_PARAM_NAMES)) {
            expect(name).toMatch(/^[a-z0-9_]{1,32}$/);
        }
    });
});
