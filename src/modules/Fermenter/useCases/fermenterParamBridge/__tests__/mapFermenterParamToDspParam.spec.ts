import { describe, expect, it } from 'vitest';

import { FERMENTER_DSP_PARAM_IDS } from '../../../models/FermenterDspParam';
import { FERMENTER_PARAMS } from '../../fermenterQueries/FERMENTER_PARAMS';
import { mapFermenterParamToDspParam } from '../mapFermenterParamToDspParam';

describe('mapFermenterParamToDspParam', () => {
    it('maps semantic TS patch keys to the Rust DSP contract names', () => {
        expect(mapFermenterParamToDspParam({ paramId: 'oscEngine' })).toBe('engine');
        expect(mapFermenterParamToDspParam({ paramId: 'filterCutoff' })).toBe('cutoff');
        expect(mapFermenterParamToDspParam({ paramId: 'filterResonance' })).toBe('resonance');
        expect(mapFermenterParamToDspParam({ paramId: 'filterEnvAmount' })).toBe('mod_env_to_filter');
        expect(mapFermenterParamToDspParam({ paramId: 'lfoPitchAmount' })).toBe('mod_lfo_to_pitch');
        expect(mapFermenterParamToDspParam({ paramId: 'oscDrift' })).toBe('drift');
        expect(mapFermenterParamToDspParam({ paramId: 'portamentoTime' })).toBe('portamento');
    });

    it('maps every public Fermenter param definition to a declared DSP param id', () => {
        const dsp_param_ids = new Set<string>(FERMENTER_DSP_PARAM_IDS);

        for (const param of FERMENTER_PARAMS) {
            expect(dsp_param_ids.has(mapFermenterParamToDspParam({ paramId: param.id })), param.id).toBe(true);
        }
    });
});
