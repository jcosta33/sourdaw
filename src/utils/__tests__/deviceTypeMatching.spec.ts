import { describe, it, expect } from 'vitest';

import { isDrumDevice, isBuiltinSynthDevice } from '../deviceTypeMatching';

describe('isDrumDevice', () => {
    it('returns true for builtin-drum-kit', () => {
        expect(isDrumDevice('builtin-drum-kit')).toBe(true);
    });

    it('returns true for bare drum-kit (legacy id)', () => {
        expect(isDrumDevice('drum-kit')).toBe(true);
    });

    it('returns true for builtin-drum-machine prefix', () => {
        expect(isDrumDevice('builtin-drum-machine-909')).toBe(true);
        expect(isDrumDevice('builtin-drum-machine-cr78')).toBe(true);
    });

    it('returns false for synth types', () => {
        expect(isDrumDevice('synth')).toBe(false);
        expect(isDrumDevice('builtin-synth-strings')).toBe(false);
    });

    it('returns false for effect types', () => {
        expect(isDrumDevice('fermenter')).toBe(false);
        expect(isDrumDevice('gluten')).toBe(false);
        expect(isDrumDevice('crust')).toBe(false);
    });

    it('returns false for arbitrary strings', () => {
        expect(isDrumDevice('')).toBe(false);
        expect(isDrumDevice('unknown')).toBe(false);
    });
});

describe('isBuiltinSynthDevice', () => {
    it('returns true for bare synth', () => {
        expect(isBuiltinSynthDevice('synth')).toBe(true);
    });

    it('returns true for builtin-synth prefix', () => {
        expect(isBuiltinSynthDevice('builtin-synth-strings')).toBe(true);
        expect(isBuiltinSynthDevice('builtin-synth-poly')).toBe(true);
    });

    it('returns false for drum types', () => {
        expect(isBuiltinSynthDevice('drum-kit')).toBe(false);
        expect(isBuiltinSynthDevice('builtin-drum-kit')).toBe(false);
        expect(isBuiltinSynthDevice('builtin-drum-machine-909')).toBe(false);
    });

    it('returns false for effect types', () => {
        expect(isBuiltinSynthDevice('crust')).toBe(false);
        expect(isBuiltinSynthDevice('fermenter')).toBe(false);
    });

    it('returns false for arbitrary strings', () => {
        expect(isBuiltinSynthDevice('')).toBe(false);
        expect(isBuiltinSynthDevice('unknown')).toBe(false);
    });
});

describe('isDrumDevice and isBuiltinSynthDevice are mutually exclusive', () => {
    it('no device type is both drum and synth', () => {
        const types = [
            'synth',
            'builtin-synth-strings',
            'builtin-synth-poly',
            'drum-kit',
            'builtin-drum-kit',
            'builtin-drum-machine-909',
            'fermenter',
            'gluten',
            'crust',
            'levain',
        ];
        for (const type of types) {
            expect(isDrumDevice(type) && isBuiltinSynthDevice(type)).toBe(false);
        }
    });
});
