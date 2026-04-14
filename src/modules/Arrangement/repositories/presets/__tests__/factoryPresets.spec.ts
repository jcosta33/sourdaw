import { describe, it, expect } from 'vitest';
import { bassPresets } from '../bassPresets';
import { keysPresets } from '../keysPresets';
import { leadPresets } from '../leadPresets';
import { padPresets } from '../padPresets';
import { stringsPresets } from '../stringsPresets';
import { FACTORY_PRESETS } from '../factoryPresets';

describe('Factory Presets', () => {
    const checkPresets = (presets: any[]) => {
        expect(presets.length).toBeGreaterThan(0);
        presets.forEach(p => {
            expect(p).toHaveProperty('id');
            expect(p).toHaveProperty('name');
            expect(p).toHaveProperty('category');
            expect(p).toHaveProperty('devices');
            expect(Array.isArray(p.devices)).toBe(true);
            expect(p.devices.length).toBeGreaterThan(0);
        });
    };

    it('bassPresets should be valid', () => checkPresets(bassPresets));
    it('keysPresets should be valid', () => checkPresets(keysPresets));
    it('leadPresets should be valid', () => checkPresets(leadPresets));
    it('padPresets should be valid', () => checkPresets(padPresets));
    it('stringsPresets should be valid', () => checkPresets(stringsPresets));
    it('FACTORY_PRESETS should contain all categories', () => {
        expect(FACTORY_PRESETS.length).toBeGreaterThan(0);
        const categories = new Set(FACTORY_PRESETS.map(p => p.category));
        expect(categories.has('bass')).toBe(true);
        expect(categories.has('keys')).toBe(true);
    });
});
