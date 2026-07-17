import { describe, it, expect } from 'vitest';

import { FACTORY_PRESETS, DRUM_KIT_PRESETS } from '../presets/factoryPresets';

describe('factoryPresets', () => {
    it('exports a non-empty array of presets', () => {
        expect(Array.isArray(FACTORY_PRESETS)).toBe(true);
        expect(FACTORY_PRESETS.length).toBeGreaterThan(0);
    });

    it('contains drum kit presets with correct properties', () => {
        expect(DRUM_KIT_PRESETS.length).toBeGreaterThan(0);
        const kit = DRUM_KIT_PRESETS[0];
        if (!kit) {
            throw new Error('expected at least one drum kit preset');
        }
        expect(kit.id).toBeDefined();
        expect(kit.category).toBe('drums');
        expect(kit.trackKind).toBe('midi');
        expect(kit.devices.length).toBeGreaterThan(0);
    });

    it('ensures all factory presets have isFactory: true', () => {
        for (const preset of FACTORY_PRESETS) {
            expect(preset.isFactory).toBe(true);
        }
    });
});
