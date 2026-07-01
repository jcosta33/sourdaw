import { describe, it, expect } from 'vitest';

import { getFermenterFactoryPresets } from '../getFermenterFactoryPresets';

describe('getFermenterFactoryPresets', () => {
    it('should expose consumer-safe Fermenter factory preset DTO values', () => {
        const presets = getFermenterFactoryPresets();

        expect(presets.length).toBeGreaterThan(0);
        expect(presets.every((preset) => preset.id.startsWith('fermenter-'))).toBe(true);
        expect(presets.every((preset) => preset.isFactory)).toBe(true);
        expect(presets.every((preset) => preset.devices.some((device) => device.type === 'fermenter'))).toBe(true);
    });

    it('should return copied preset objects on every call', () => {
        const first_presets = getFermenterFactoryPresets();
        const first_preset = first_presets[0];

        if (!first_preset) {
            throw new Error('Expected at least one Fermenter preset');
        }

        const first_device = first_preset.devices[0];

        if (!first_device) {
            throw new Error('Expected the first Fermenter preset to include a device');
        }

        first_preset.name = 'Mutated Preset';
        first_preset.tags.push('mutated-tag');
        first_device.name = 'Mutated Device';
        first_device.parameterValues.masterGain = 0.01;

        const second_presets = getFermenterFactoryPresets();
        const second_preset = second_presets[0];

        if (!second_preset) {
            throw new Error('Expected at least one Fermenter preset');
        }

        const second_device = second_preset.devices[0];

        if (!second_device) {
            throw new Error('Expected the first Fermenter preset to include a device');
        }

        expect(second_preset.name).not.toBe('Mutated Preset');
        expect(second_preset.tags).not.toContain('mutated-tag');
        expect(second_device.name).not.toBe('Mutated Device');
        expect(second_device.parameterValues.masterGain).not.toBe(0.01);
    });
});
