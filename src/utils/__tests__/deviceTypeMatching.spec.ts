import { describe, it, expect } from 'vitest';

import { dbToGain } from '../audioLevelLaw';
import {
    DRUM_KIT_DEFAULT_LEVEL_DB,
    isDrumDevice,
    isBuiltinSynthDevice,
    resolveDrumKitBy,
    resolveDrumKitOutputGain,
} from '../deviceTypeMatching';

describe('resolveDrumKitOutputGain', () => {
    it('reads the level of the first drum device on the chain, the one the kit comes from', () => {
        const devices: { type: string; parameterValues: Record<string, number> }[] = [
            { type: 'eq', parameterValues: { level: -20 } },
            { type: 'builtin-drum-machine-808', parameterValues: { kit: 1, level: -6 } },
            { type: 'builtin-drum-kit', parameterValues: { kit: 0, level: -12 } },
        ];
        expect(resolveDrumKitOutputGain(devices)).toBe(dbToGain(-6));
    });

    it('plays a drum device that stores no level at unity, the level every kit had before it', () => {
        expect(DRUM_KIT_DEFAULT_LEVEL_DB).toBe(0);
        expect(resolveDrumKitOutputGain([{ type: 'drum-kit', parameterValues: { kitId: 2 } }])).toBe(1);
    });

    it.each([0.8, 0.6, 0])('ignores a legacy stored gain of %s, which no kit ever played at', (gain) => {
        expect(resolveDrumKitOutputGain([{ type: 'builtin-drum-kit', parameterValues: { kit: 0, gain } }])).toBe(1);
    });
});

describe('resolveDrumKitBy', () => {
    const lookup = (kitIndex: number) => (kitIndex < 3 ? `kit-${kitIndex}` : null);

    it.each([
        'builtin-drum-kit',
        'drum-kit',
        'builtin-drum-machine-808',
        'builtin-drum-machine-analog',
        'builtin-drum-machine-electronic',
        'builtin-drum-machine-acoustic',
    ])('resolves the kit a %s device selects', (type) => {
        expect(resolveDrumKitBy([{ type, parameterValues: { kit: 2 } }], lookup)).toBe('kit-2');
    });

    it('reads the legacy kitId when kit is absent and index 0 when neither is set', () => {
        expect(resolveDrumKitBy([{ type: 'drum-kit', parameterValues: { kitId: 1 } }], lookup)).toBe('kit-1');
        expect(resolveDrumKitBy([{ type: 'builtin-drum-machine-808', parameterValues: {} }], lookup)).toBe('kit-0');
    });

    it('prefers kit over kitId', () => {
        expect(resolveDrumKitBy([{ type: 'drum-kit', parameterValues: { kit: 0, kitId: 2 } }], lookup)).toBe('kit-0');
    });

    it('takes the first drum device on the chain', () => {
        const devices = [
            { type: 'eq', parameterValues: { kit: 2 } },
            { type: 'builtin-drum-machine-808', parameterValues: { kit: 1 } },
            { type: 'builtin-drum-kit', parameterValues: { kit: 0 } },
        ];
        expect(resolveDrumKitBy(devices, lookup)).toBe('kit-1');
    });

    it('is null without a drum device and when the lookup knows no kit at the index', () => {
        expect(resolveDrumKitBy([{ type: 'builtin-synth-strings', parameterValues: { kit: 0 } }], lookup)).toBeNull();
        expect(resolveDrumKitBy([{ type: 'builtin-drum-kit', parameterValues: { kit: 9 } }], lookup)).toBeNull();
    });
});

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
