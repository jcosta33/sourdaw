import { describe, expect, it, vi } from 'vitest';

import { DRUM_KIT_DEFAULT_LEVEL_DB } from '#/utils/deviceTypeMatching';

import { BUILTIN_PLUGINS, getPluginById, isDeviceSupportedOnCurrentPlatform } from '../DeviceParameter';

describe('drum kit level', () => {
    const DRUM_KIT_TYPES = [
        'builtin-drum-kit',
        'builtin-drum-machine-808',
        'builtin-drum-machine-analog',
        'builtin-drum-machine-electronic',
        'builtin-drum-machine-acoustic',
    ];

    // The kit schedulers play a device that stores no level at
    // DRUM_KIT_DEFAULT_LEVEL_DB, so it must be the default the descriptors
    // declare, and it must be unity: every kit saved before the level existed
    // played at unity and must keep doing so.
    it.each(DRUM_KIT_TYPES)('%s declares a dB level whose default is the unity the schedulers fall back to', (id) => {
        const level = getPluginById(id)?.parameters.find((parameter) => parameter.id === 'level');
        expect(level).toMatchObject({ unit: 'dB', defaultValue: DRUM_KIT_DEFAULT_LEVEL_DB, value: 0, minValue: -60 });
        expect(DRUM_KIT_DEFAULT_LEVEL_DB).toBe(0);
    });

    // The former unitless gain was never read; projects still store it, so it
    // stays undeclared (agents cannot address it) and inert.
    it.each(DRUM_KIT_TYPES)('%s declares no gain parameter', (id) => {
        expect(getPluginById(id)?.parameters.map((parameter) => parameter.id)).toEqual(['kit', 'level']);
    });
});

describe('getPluginById', () => {
    it('returns a descriptor for a known built-in id', () => {
        const eq = getPluginById('builtin-eq');
        expect(eq).toBeDefined();
        expect(eq!.id).toBe('builtin-eq');
    });

    it('returns undefined for unknown ids', () => {
        expect(getPluginById('not-a-real-plugin-id')).toBeUndefined();
    });
});

describe('isDeviceSupportedOnCurrentPlatform', () => {
    it('allows unknown device types to pass through', () => {
        expect(isDeviceSupportedOnCurrentPlatform('third-party-vst-instance')).toBe(true);
    });

    it('treats every catalog entry as supported here (descriptors use platform both)', () => {
        expect(BUILTIN_PLUGINS.length).toBeGreaterThan(0);
        const first = BUILTIN_PLUGINS[0]!;
        expect(isDeviceSupportedOnCurrentPlatform(first.id)).toBe(true);
    });

    it('supports Grand Boule after release admission', () => {
        expect(isDeviceSupportedOnCurrentPlatform('grand-boule')).toBe(true);
    });

    it('reports a built-in plugin as supported when running under the native desktop runtime', () => {
        // The native runtime gate is the presence of the desktop bridge the
        // Electron preload publishes as `window.sourdaw`; simulating it must let
        // any catalog entry through.
        const first = BUILTIN_PLUGINS[0]!;
        (window as unknown as { sourdaw?: unknown }).sourdaw = {};

        try {
            expect(isDeviceSupportedOnCurrentPlatform(first.id)).toBe(true);
        } finally {
            delete (window as unknown as { sourdaw?: unknown }).sourdaw;
        }
    });

    it('keeps admitted Grand Boule supported in the desktop runtime', () => {
        (window as unknown as { sourdaw?: unknown }).sourdaw = {};

        try {
            expect(isDeviceSupportedOnCurrentPlatform('grand-boule')).toBe(true);
        } finally {
            delete (window as unknown as { sourdaw?: unknown }).sourdaw;
        }
    });
});

describe('synth/drum variant base descriptor lookup', () => {
    // `createSynthVariant`/`createDrumVariant` resolve their base descriptor by
    // id when the module loads. A missing base used to be a bare `.find(...)!`,
    // so a renamed or removed `builtin-synth`/`builtin-drum-kit` descriptor
    // crashed the whole module import with a generic
    // `Cannot read properties of undefined` deep inside a spread, rather than
    // naming which descriptor id went missing.
    it('throws a descriptive error, not a generic property-access crash, when builtin-synth is missing', async () => {
        vi.resetModules();
        vi.doMock('../PluginDescriptors/BuiltinInstrumentDescriptors', async () => {
            const actual = await vi.importActual<{
                BUILTIN_INSTRUMENT_DESCRIPTORS: unknown[];
            }>('../PluginDescriptors/BuiltinInstrumentDescriptors');
            return {
                BUILTIN_INSTRUMENT_DESCRIPTORS: (actual.BUILTIN_INSTRUMENT_DESCRIPTORS as { id: string }[]).filter(
                    (descriptor) => descriptor.id !== 'builtin-synth'
                ),
            };
        });

        await expect(import('../DeviceParameter')).rejects.toThrow('builtin-synth');

        vi.doUnmock('../PluginDescriptors/BuiltinInstrumentDescriptors');
        vi.resetModules();
    });

    it('throws a descriptive error, not a generic property-access crash, when builtin-drum-kit is missing', async () => {
        vi.resetModules();
        vi.doMock('../PluginDescriptors/BuiltinInstrumentDescriptors', async () => {
            const actual = await vi.importActual<{
                BUILTIN_INSTRUMENT_DESCRIPTORS: unknown[];
            }>('../PluginDescriptors/BuiltinInstrumentDescriptors');
            return {
                BUILTIN_INSTRUMENT_DESCRIPTORS: (actual.BUILTIN_INSTRUMENT_DESCRIPTORS as { id: string }[]).filter(
                    (descriptor) => descriptor.id !== 'builtin-drum-kit'
                ),
            };
        });

        await expect(import('../DeviceParameter')).rejects.toThrow('builtin-drum-kit');

        vi.doUnmock('../PluginDescriptors/BuiltinInstrumentDescriptors');
        vi.resetModules();
    });
});
