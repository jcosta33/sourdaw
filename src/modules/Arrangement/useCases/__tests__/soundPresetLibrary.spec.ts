import { describe, it, expect } from 'vitest';

import { FERMENTER_PRESETS } from '#/modules/Fermenter/useCases';

import { getFactoryPresets } from '../soundPresetLibrary';

describe('soundPresetLibrary', () => {
    it('should export getFactoryPresets', () => {
        expect(typeof getFactoryPresets).toBe('function');
    });

    it('should include Fermenter presets from the use-case composition layer', () => {
        const fermenter_preset = FERMENTER_PRESETS.find((preset) => preset.id === 'fermenter-init');
        const factory_preset = getFactoryPresets().find((preset) => preset.id === 'fermenter-init');

        expect(fermenter_preset).toMatchObject({
            id: 'fermenter-init',
            name: 'Blank Dough',
            devices: [{ type: 'fermenter' }],
        });
        expect(factory_preset).toMatchObject({
            id: 'fermenter-init',
            name: 'Blank Dough',
            devices: [{ type: 'fermenter' }],
        });
    });
});
