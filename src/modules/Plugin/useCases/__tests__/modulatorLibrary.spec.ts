import { describe, it, expect } from 'vitest';

import { MODULATOR_PRESETS } from '../modulatorLibrary';

describe('MODULATOR_PRESETS', () => {
    it('should expose at least one preset per major category', () => {
        const categories = new Set(MODULATOR_PRESETS.map((p) => p.category));
        expect(categories.has('LFO')).toBe(true);
        expect(categories.has('Envelope')).toBe(true);
    });

    it('should use unique ids for every preset', () => {
        const ids = MODULATOR_PRESETS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('should include required fields on each preset', () => {
        for (const p of MODULATOR_PRESETS) {
            expect(p.id.length).toBeGreaterThan(0);
            expect(p.name.length).toBeGreaterThan(0);
            expect(p.sourceType.length).toBeGreaterThan(0);
            expect(typeof p.parameters).toBe('object');
        }
    });
});
