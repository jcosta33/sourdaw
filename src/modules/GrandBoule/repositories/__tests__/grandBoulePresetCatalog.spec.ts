import { describe, expect, it } from 'vitest';

import { listBuiltinGrandBoulePresets } from '../grandBoulePresetCatalog';

describe('listBuiltinGrandBoulePresets', () => {
    it('should return a stable non-empty catalog with unique ids', () => {
        const a = listBuiltinGrandBoulePresets();
        const b = listBuiltinGrandBoulePresets();
        expect(a.length).toBeGreaterThan(0);
        expect(a).toBe(b);

        const ids = a.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('should expose expected parameter keys on each preset', () => {
        for (const preset of listBuiltinGrandBoulePresets()) {
            expect(preset.id).toMatch(/^grand-boule-/);
            expect(preset.name.length).toBeGreaterThan(0);
            expect(preset.parameters).toMatchObject({
                hammerHardness: expect.any(Number),
                velocityCurve: expect.any(Number),
                stereoWidth: expect.any(Number),
                toneTilt: expect.any(Number),
            });
        }
    });
});
