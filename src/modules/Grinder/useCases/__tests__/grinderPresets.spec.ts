import { describe, it, expect } from 'vitest';
import { GRINDER_PRESETS } from '../grinderPresets';

describe('GRINDER_PRESETS', () => {
    it('exposes a non-empty preset list', () => {
        expect(GRINDER_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has id, name, category, and a patch', () => {
        for (const preset of GRINDER_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(preset.name).toBeTruthy();
            expect(preset.category).toBeTruthy();
            expect(preset.patch).toBeDefined();
            expect(preset.patch.name).toBe(preset.name);
        }
    });

    it('preset ids are unique', () => {
        const ids = GRINDER_PRESETS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
