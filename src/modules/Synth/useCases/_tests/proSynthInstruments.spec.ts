import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Plugin', () => ({
    registerFaustDSP: vi.fn(),
}));

import { registerProSynthInstruments } from '../proSynthInstruments';
import { registerFaustDSP } from '#/modules/Plugin';

describe('registerProSynthInstruments', () => {
    beforeEach(() => {
        vi.mocked(registerFaustDSP).mockClear();
    });

    it('registers the four pro instruments with Faust DSP source and params', () => {
        registerProSynthInstruments();

        expect(registerFaustDSP).toHaveBeenCalledTimes(4);
        const names = vi.mocked(registerFaustDSP).mock.calls.map((c) => c[0]);
        expect(names).toEqual(
            expect.arrayContaining(['Morphing Synth', 'Supersaw Unison', 'Physical Model String', 'Additive Synth'])
        );

        for (const call of vi.mocked(registerFaustDSP).mock.calls) {
            const [, dsp, params] = call;
            expect(typeof dsp).toBe('string');
            expect(dsp.length).toBeGreaterThan(0);
            expect(Array.isArray(params)).toBe(true);
            expect(params.length).toBeGreaterThan(0);
        }
    });
});
