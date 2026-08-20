import { describe, expect, it, vi } from 'vitest';

import { BUILTIN_PLUGINS, getPluginById, isDeviceSupportedOnCurrentPlatform } from '../DeviceParameter';

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

    it('withholds devices that have not passed release admission', () => {
        expect(isDeviceSupportedOnCurrentPlatform('grand-boule')).toBe(false);
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

    it('does not let the desktop runtime bypass release admission', () => {
        (window as unknown as { sourdaw?: unknown }).sourdaw = {};

        try {
            expect(isDeviceSupportedOnCurrentPlatform('grand-boule')).toBe(false);
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
