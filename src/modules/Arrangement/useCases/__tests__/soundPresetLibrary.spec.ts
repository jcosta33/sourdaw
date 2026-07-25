import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getFermenterFactoryPresets } from '#/modules/Fermenter/useCases';

import { getFactoryPresets } from '../soundPresetLibrary';

describe('soundPresetLibrary', () => {
    it('should export getFactoryPresets', () => {
        expect(typeof getFactoryPresets).toBe('function');
    });

    it('should include every Fermenter factory preset from the Fermenter use-case contract', () => {
        const fermenter_presets = getFermenterFactoryPresets();
        const factory_preset_ids = new Set(getFactoryPresets().map((preset) => preset.id));

        expect(fermenter_presets.length).toBeGreaterThan(0);
        expect(fermenter_presets.every((preset) => factory_preset_ids.has(preset.id))).toBe(true);
    });

    it('returns a stable array reference on repeat calls within the same platform', () => {
        const first = getFactoryPresets();
        const second = getFactoryPresets();

        expect(second).toBe(first);
    });
});

describe('getFactoryPresets platform cache', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        const internalsKey = '__TAURI_INTERNALS__';
        const windowRecord = globalThis.window as unknown as Record<string, unknown>;
        if (internalsKey in windowRecord) {
            delete windowRecord[internalsKey];
        }
    });

    it('rebuilds the cache when the runtime switches to the native (Tauri) platform', async () => {
        const { getFactoryPresets: freshGetFactoryPresets } = await import('../soundPresetLibrary');

        // Web platform (no Tauri internals): builds and caches the web catalogue.
        const webPresets = freshGetFactoryPresets();

        // Switch the runtime to native — the cached platform key no longer
        // matches, so the catalogue must be rebuilt.
        (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
        const nativePresets = freshGetFactoryPresets();

        // Native rebuild invalidates the web cache entry, producing a fresh array.
        expect(nativePresets).not.toBe(webPresets);
        // Every builtin preset is platform:'both', so nothing is filtered out on
        // native either — the catalogue is identical in content.
        expect(nativePresets.map((preset) => preset.id)).toEqual(webPresets.map((preset) => preset.id));
    });
});
