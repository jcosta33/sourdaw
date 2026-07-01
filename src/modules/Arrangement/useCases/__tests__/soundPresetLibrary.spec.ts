import { describe, it, expect } from 'vitest';

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
});
