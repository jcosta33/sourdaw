import { describe, expect, it } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { mapFermenterPatchToDspPatch } from '../mapFermenterPatchToDspPatch';

describe('mapFermenterPatchToDspPatch', () => {
    it('maps numeric patch fields to DSP ids and excludes non-numeric metadata', () => {
        const patch = mapFermenterPatchToDspPatch({ patch: DEFAULT_PATCH });

        expect(patch.engine).toBe(DEFAULT_PATCH.oscEngine);
        expect(patch.cutoff).toBe(DEFAULT_PATCH.filterCutoff);
        expect(patch.resonance).toBe(DEFAULT_PATCH.filterResonance);
        expect(patch.mod_env_to_filter).toBe(DEFAULT_PATCH.filterEnvAmount);
        expect(patch.mod_lfo_to_pitch).toBe(DEFAULT_PATCH.lfoPitchAmount);
        expect(patch.drift).toBe(DEFAULT_PATCH.oscDrift);
        expect(patch.portamento).toBe(DEFAULT_PATCH.portamentoTime);
        expect('name' in patch).toBe(false);
        expect('macros' in patch).toBe(false);
    });
});
