import { describe, expect, it } from 'vitest';

import { FAUST_EFFECT_PRESETS } from '../../../repositories/presets/faustEffectPresets';
import { FAUST_EFFECT_DESCRIPTORS } from '../FaustEffectDescriptors';

describe('FaustEffectDescriptors', () => {
    it('exports effect descriptors', () => {
        expect(FAUST_EFFECT_DESCRIPTORS.length).toBeGreaterThan(0);
    });

    it('every descriptor has a unique faust- prefixed id', () => {
        const ids = new Set<string>();
        for (const desc of FAUST_EFFECT_DESCRIPTORS) {
            expect(desc.id).toMatch(/^faust-/);
            expect(ids.has(desc.id)).toBe(false);
            ids.add(desc.id);
        }
    });

    it('every descriptor has non-empty name and vendor', () => {
        for (const desc of FAUST_EFFECT_DESCRIPTORS) {
            expect(desc.name).toBeTruthy();
            expect(desc.vendor).toBeTruthy();
        }
    });

    it('every descriptor has a valid category', () => {
        const validCategories = new Set(['effect', 'analyzer', 'utility']);
        for (const desc of FAUST_EFFECT_DESCRIPTORS) {
            expect(validCategories.has(desc.category)).toBe(true);
        }
    });

    it('every descriptor has a parameters array', () => {
        for (const desc of FAUST_EFFECT_DESCRIPTORS) {
            expect(Array.isArray(desc.parameters)).toBe(true);
        }
    });

    it('includes well-known faust effect ids', () => {
        const ids = FAUST_EFFECT_DESCRIPTORS.map((d) => d.id);
        expect(ids).toContain('faust-1176-compressor');
        expect(ids).toContain('faust-tape-delay');
        expect(ids).toContain('faust-zita-rev1-reverb');
    });
});

describe('faustEffectPresets', () => {
    it('exports presets', () => {
        expect(FAUST_EFFECT_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has a unique id', () => {
        const ids = new Set<string>();
        for (const preset of FAUST_EFFECT_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(ids.has(preset.id)).toBe(false);
            ids.add(preset.id);
        }
    });

    it('every preset has a non-empty name', () => {
        for (const preset of FAUST_EFFECT_PRESETS) {
            expect(preset.name).toBeTruthy();
        }
    });

    it('every preset has at least one device', () => {
        for (const preset of FAUST_EFFECT_PRESETS) {
            expect(preset.devices.length).toBeGreaterThan(0);
        }
    });

    it('every device has a faust- prefixed type', () => {
        for (const preset of FAUST_EFFECT_PRESETS) {
            for (const device of preset.devices) {
                expect(device.type).toMatch(/^faust-/);
            }
        }
    });
});
