import { describe, expect, it } from 'vitest';

import { findBuiltinGrandBoulePreset } from '../findBuiltinGrandBoulePreset';
import { listBuiltinGrandBoulePresets } from '../grandBoulePresetCatalog';

describe('findBuiltinGrandBoulePreset', () => {
    it('should resolve each built-in id to the same object as the catalog', () => {
        const catalog = listBuiltinGrandBoulePresets();
        for (const preset of catalog) {
            expect(findBuiltinGrandBoulePreset(preset.id)).toBe(preset);
        }
    });

    it('should return null for unknown ids', () => {
        expect(findBuiltinGrandBoulePreset('not-a-preset')).toBeNull();
        expect(findBuiltinGrandBoulePreset('')).toBeNull();
    });
});
