import { describe, it, expect } from 'vitest';

import { FACTORY_PRESETS } from '../presets/factoryPresets';

describe('factoryPresets', () => {
    it('exports a non-empty array of presets', () => {
        expect(Array.isArray(FACTORY_PRESETS)).toBe(true);
        expect(FACTORY_PRESETS.length).toBeGreaterThan(0);
    });

    it('contains the four drum kit presets with correct properties', () => {
        // The drum kits are deliberately not exported on their own (audit
        // M-020): the aggregate is the single surface, so derive them from it.
        const drumKits = FACTORY_PRESETS.filter((preset) => preset.id.startsWith('factory-drumkit-'));
        expect(drumKits.map((preset) => preset.id).sort()).toEqual([
            'factory-drumkit-808',
            'factory-drumkit-acoustic',
            'factory-drumkit-analog',
            'factory-drumkit-electronic',
        ]);
        for (const kit of drumKits) {
            expect(kit.category).toBe('drums');
            expect(kit.trackKind).toBe('midi');
            expect(kit.devices.length).toBeGreaterThan(0);
        }
    });

    it('ensures all factory presets have isFactory: true', () => {
        for (const preset of FACTORY_PRESETS) {
            expect(preset.isFactory).toBe(true);
        }
    });
});
