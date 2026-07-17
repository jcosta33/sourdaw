import { describe, it, expect } from 'vitest';

import { createNeutralPresetParameters } from '../../models/GrandBoulePreset';
import { findBuiltinGrandBoulePreset } from '../findBuiltinGrandBoulePreset';
import { listBuiltinGrandBoulePresets } from '../grandBoulePresetCatalog';

describe('listBuiltinGrandBoulePresets', () => {
    const presets = listBuiltinGrandBoulePresets();

    it('returns non-empty array', () => {
        expect(presets.length).toBeGreaterThan(0);
    });

    it('every preset has unique id', () => {
        const ids = presets.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every preset has name and parameters', () => {
        for (const p of presets) {
            expect(p.name).toBeTruthy();
            expect(p.parameters).toBeDefined();
            expect(typeof p.parameters.hammerHardness).toBe('number');
            expect(typeof p.parameters.velocityCurve).toBe('number');
        }
    });

    it('includes Classic Miche preset', () => {
        const classic = presets.find((p) => p.id === 'grand-boule-classic');
        expect(classic).toBeDefined();
        expect(classic!.name).toBe('Classic Miche');
    });
});

describe('findBuiltinGrandBoulePreset', () => {
    it('finds preset by id', () => {
        const preset = findBuiltinGrandBoulePreset('grand-boule-classic');
        expect(preset).not.toBeNull();
        expect(preset!.name).toBe('Classic Miche');
    });

    it('returns null for unknown id', () => {
        expect(findBuiltinGrandBoulePreset('nonexistent')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(findBuiltinGrandBoulePreset('')).toBeNull();
    });
});

describe('createNeutralPresetParameters', () => {
    it('returns neutral defaults', () => {
        const params = createNeutralPresetParameters();
        expect(params.hammerHardness).toBe(0);
        expect(params.velocityCurve).toBe(1.0);
        expect(params.stereoWidth).toBe(0.6);
        expect(params.toneTilt).toBe(0);
    });
});
