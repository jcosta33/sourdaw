import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/PluginHost/useCases', () => ({
    registerFaustDSP: vi.fn(),
}));

import { registerFaustDSP } from '#/modules/PluginHost/useCases';

import { registerProSynthInstruments } from '../proSynthInstruments';

describe('registerProSynthInstruments', () => {
    beforeEach(() => {
        vi.mocked(registerFaustDSP).mockClear();
    });

    it('registers the Synth-owned pro instruments with Faust DSP source and params', () => {
        registerProSynthInstruments();

        expect(registerFaustDSP).toHaveBeenCalledTimes(3);
        const names = vi.mocked(registerFaustDSP).mock.calls.map((c) => c[0]);
        expect(names).toEqual(expect.arrayContaining(['Morphing Synth', 'Physical Model String', 'Additive Synth']));

        for (const call of vi.mocked(registerFaustDSP).mock.calls) {
            const [, dsp, params] = call;
            expect(typeof dsp).toBe('string');
            expect(dsp.length).toBeGreaterThan(0);
            if (!params) {
                throw new Error('Expected params to be provided for every pro instrument');
            }
            expect(Array.isArray(params)).toBe(true);
            expect(params.length).toBeGreaterThan(0);
        }
    });
});
