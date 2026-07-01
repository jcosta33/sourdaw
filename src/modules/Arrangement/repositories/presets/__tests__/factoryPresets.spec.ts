import { describe, it, expect } from 'vitest';

import { type SoundPreset } from '../../../models/SoundPreset';
import { bassPresets } from '../bassPresets';
import { FACTORY_PRESETS } from '../factoryPresets';
import { keysPresets } from '../keysPresets';
import { leadPresets } from '../leadPresets';
import { padPresets } from '../padPresets';
import { stringsPresets } from '../stringsPresets';

describe('Factory Presets', () => {
    function checkPresets(presets: SoundPreset[]) {
        expect(presets.length).toBeGreaterThan(0);
        for (const param of presets) {
            expect(param).toHaveProperty('id');
            expect(param).toHaveProperty('name');
            expect(param).toHaveProperty('category');
            expect(param).toHaveProperty('devices');
            expect(Array.isArray(param.devices)).toBe(true);
            expect(param.devices.length).toBeGreaterThan(0);
        }
    }

    it('bassPresets should be valid', () => checkPresets(bassPresets));
    it('keysPresets should be valid', () => checkPresets(keysPresets));
    it('leadPresets should be valid', () => checkPresets(leadPresets));
    it('padPresets should be valid', () => checkPresets(padPresets));
    it('stringsPresets should be valid', () => checkPresets(stringsPresets));
    it('FACTORY_PRESETS should contain all categories', () => {
        expect(FACTORY_PRESETS.length).toBeGreaterThan(0);
        const categories = new Set(FACTORY_PRESETS.map((param) => param.category));
        expect(categories.has('bass')).toBe(true);
        expect(categories.has('keys')).toBe(true);
    });

    it('FACTORY_PRESETS should stay Arrangement-local and exclude Fermenter presets', () => {
        expect(
            FACTORY_PRESETS.some((preset) => {
                return (
                    preset.id.startsWith('fermenter-') || preset.devices.some((device) => device.type === 'fermenter')
                );
            })
        ).toBe(false);
    });
});
