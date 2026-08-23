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

    it('lists every preset id exactly once — drum kits included once, not twice (audit M-020)', () => {
        const idCounts = new Map<string, number>();
        for (const preset of getFactoryPresets()) {
            idCounts.set(preset.id, (idCounts.get(preset.id) ?? 0) + 1);
        }

        const duplicatedIds = [...idCounts.entries()]
            .filter(([, count]) => count > 1)
            .map(([id]) => id)
            .sort();
        expect(duplicatedIds).toEqual([]);

        // Presence pin (ADR 0015): a dedupe that dropped the drum kits outright
        // would also be a defect, so each kit must appear exactly once.
        const drumKitIds = [
            'factory-drumkit-808',
            'factory-drumkit-analog',
            'factory-drumkit-electronic',
            'factory-drumkit-acoustic',
        ];
        for (const id of drumKitIds) {
            expect(idCounts.get(id)).toBe(1);
        }
    });

    it('returns a stable array reference on repeat calls within the same platform', () => {
        const first = getFactoryPresets();
        const second = getFactoryPresets();

        expect(second).toBe(first);
    });

    it('includes the Grand Boule factory preset', () => {
        expect(getFactoryPresets().some(({ id }) => id === 'grand-boule-default')).toBe(true);
    });
});

describe('getFactoryPresets platform cache', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        const bridgeKey = 'sourdaw';
        const windowRecord = globalThis.window as unknown as Record<string, unknown>;
        if (bridgeKey in windowRecord) {
            delete windowRecord[bridgeKey];
        }
    });

    it('rebuilds the cache with native-only presets when the runtime switches to desktop', async () => {
        const { getFactoryPresets: freshGetFactoryPresets } = await import('../soundPresetLibrary');

        // Web platform (no desktop bridge): builds and caches the web catalogue.
        const webPresets = freshGetFactoryPresets();

        // Switch the runtime to native — the cached platform key no longer
        // matches, so the catalogue must be rebuilt.
        (globalThis.window as unknown as Record<string, unknown>).sourdaw = {};
        const nativePresets = freshGetFactoryPresets();

        // Native rebuild invalidates the web cache entry, producing a fresh array.
        expect(nativePresets).not.toBe(webPresets);
        const webPresetIds = new Set(webPresets.map((preset) => preset.id));
        const nativePresetIds = nativePresets.map((preset) => preset.id);

        // Release admission is runtime-independent, but platform capability is
        // not: Crumbs can acquire samples only through the desktop bridge, so
        // its sampler shortcut is the one native-only catalogue entry.
        expect(nativePresetIds.filter((id) => !webPresetIds.has(id))).toEqual(['sampler-default']);
        expect(webPresets.every(({ id }) => nativePresetIds.includes(id))).toBe(true);
    });
});
