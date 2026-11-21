import { describe, it, expect } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';

import { DRUM_KIT_DEFAULT_LEVEL_DB, resolveDrumKitBy, resolveDrumKitOutputGain } from '../DrumKitSelection';

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
