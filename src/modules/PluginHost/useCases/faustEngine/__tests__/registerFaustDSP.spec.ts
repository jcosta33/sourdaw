import { describe, it, expect, beforeEach } from 'vitest';

import { type FaustParamDescriptor } from '../../../models/FaustEngineTypes';
import { faustEngineState } from '../faustEngineState';
import { registerFaustDSP } from '../registerFaustDSP';

function descriptor(overrides: Partial<FaustParamDescriptor> = {}): FaustParamDescriptor {
    return {
        address: '/gain',
        label: 'Gain',
        min: 0,
        max: 1,
        defaultValue: 0.5,
        step: 0.01,
        type: 'hslider',
        ...overrides,
    };
}

describe('registerFaustDSP', () => {
    beforeEach(() => {
        faustEngineState.modules.clear();
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

    it('should refuse a descriptor whose address is not rooted at a slash', () => {
        expect(() => registerFaustDSP('Gain', 'process = _;', [descriptor({ address: 'gain' })])).toThrow(
            /address must be rooted/
        );
    });

    it('should refuse one address declared twice in a module', () => {
        expect(() =>
            registerFaustDSP('Gain', 'process = _;', [descriptor(), descriptor({ label: 'Gain again' })])
        ).toThrow(/declared twice/);
    });

    it('should refuse a range where min is not below max', () => {
        expect(() => registerFaustDSP('Gain', 'process = _;', [descriptor({ min: 1, max: 1 })])).toThrow(
            /must be below max/
        );
    });

    it('should refuse a default outside the declared range', () => {
        expect(() => registerFaustDSP('Gain', 'process = _;', [descriptor({ defaultValue: 2 })])).toThrow(
            /lies outside/
        );
    });

    it('should refuse a non-positive step', () => {
        expect(() => registerFaustDSP('Gain', 'process = _;', [descriptor({ step: 0 })])).toThrow(
            /step 0 must be positive/
        );
    });

    it('should store no module when validation refuses the table', () => {
        expect(() => registerFaustDSP('Gain', 'process = _;', [descriptor({ step: 0 })])).toThrow();
        expect(faustEngineState.modules.has('faust-gain')).toBe(false);
    });
});
