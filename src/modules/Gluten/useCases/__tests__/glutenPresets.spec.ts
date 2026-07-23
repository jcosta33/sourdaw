import { describe, it, expect } from 'vitest';

import { GLUTEN_PRESETS } from '../glutenPresets';

describe('GLUTEN_PRESETS', () => {
    it('exposes a non-empty preset list', () => {
        expect(GLUTEN_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has a unique id, non-empty name/category, and a matching patch name', () => {
        const ids = GLUTEN_PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const preset of GLUTEN_PRESETS) {
            expect(preset.id.length).toBeGreaterThan(0);
            expect(preset.name.length).toBeGreaterThan(0);
            expect(preset.category.length).toBeGreaterThan(0);
            expect(preset.patch.name).toBe(preset.name);
        }
    });

    it('every preset patch has compressor fields within documented ranges', () => {
        for (const preset of GLUTEN_PRESETS) {
            const patch = preset.patch;
            // threshold: -60 to 0 dB
            expect(patch.threshold).toBeGreaterThanOrEqual(-60);
            expect(patch.threshold).toBeLessThanOrEqual(0);
            // ratio: 1–20
            expect(patch.ratio).toBeGreaterThanOrEqual(1);
            expect(patch.ratio).toBeLessThanOrEqual(20);
            // attack: 0.02–250 ms
            expect(patch.attack).toBeGreaterThanOrEqual(0.02);
            expect(patch.attack).toBeLessThanOrEqual(250);
            // release: 25–5000 ms
            expect(patch.release).toBeGreaterThanOrEqual(25);
            expect(patch.release).toBeLessThanOrEqual(5000);
            // knee: 0–30 dB
            expect(patch.knee).toBeGreaterThanOrEqual(0);
            expect(patch.knee).toBeLessThanOrEqual(30);
            // mix: 0–1
            expect(patch.mix).toBeGreaterThanOrEqual(0);
            expect(patch.mix).toBeLessThanOrEqual(1);
        }
    });

    it('presets span more than one category', () => {
        const categories = new Set(GLUTEN_PRESETS.map((preset) => preset.category));
        expect(categories.size).toBeGreaterThan(1);
    });
});
