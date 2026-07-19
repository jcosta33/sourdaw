import { describe, it, expect, beforeEach } from 'vitest';

import { registry } from '../../wamPluginHost/hostOperations/helpers';
import { faustEngineState } from '../faustEngineState';
import { registerFaustDSP } from '../registerFaustDSP';

describe('registerFaustDSP', () => {
    beforeEach(() => {
        faustEngineState.modules.clear();
        registry.clear();
    });

    it('should derive a lowercase, dash-joined wire id from the display name', () => {
        const module = registerFaustDSP('Warm  Tape Saturator', 'process = _;');
        expect(module.id).toBe('faust-warm-tape-saturator');
    });

    it('should default params to an empty array and isInstrument to false', () => {
        const module = registerFaustDSP('Simple Gain', 'process = _;');

        expect(module.paramDescriptors).toEqual([]);
        expect(module.isInstrument).toBe(false);
        expect(module.compiled).toBe(false);
        expect(module.generator).toBeNull();
    });

    it('should preserve the supplied parameter descriptors on the module', () => {
        const params = [
            {
                address: '/gain',
                label: 'Gain',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider' as const,
            },
        ];

        const module = registerFaustDSP('Gain', 'process = _;', params);

        expect(module.paramDescriptors).toBe(params);
    });

    it('should store the module under its wire id in faustEngineState', () => {
        const module = registerFaustDSP('Reverb', 'process = _;');
        expect(faustEngineState.modules.get('faust-reverb')).toBe(module);
    });

    it('should register a matching WAM descriptor as an effect by default', () => {
        registerFaustDSP('Reverb', 'process = _;', [], false);

        expect(registry.get('faust.faust-reverb')).toEqual({
            id: 'faust.faust-reverb',
            name: '[Faust] Reverb',
            vendor: 'Faust/Sourdaw',
            version: '1.0',
            category: 'effect',
            sdkVersion: '2.0',
            keywords: ['faust', 'dsp'],
        });
    });

    it('should register the WAM descriptor as an instrument when isInstrument is true', () => {
        registerFaustDSP('Poly Synth', 'process = _;', [], true);
        expect(registry.get('faust.faust-poly-synth')?.category).toBe('instrument');
    });
});
