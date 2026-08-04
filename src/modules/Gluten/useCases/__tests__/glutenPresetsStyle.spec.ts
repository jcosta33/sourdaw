import { describe, it, expect } from 'vitest';

import { GLUTEN_PRESETS } from '../glutenPresets';

/**
 * inferStyle is a private function in glutenPresets.ts that maps topology → style.
 * Its branches: explicit override (style truthy), fet→punch, opto→smooth,
 * diode→glue, fallback→glue. These specs observe the result through each preset's
 * .patch.style, exercising every branch.
 */

describe('GLUTEN_PRESETS — inferStyle topology mapping', () => {
    it('fet topology presets map to punch style', () => {
        const fet = GLUTEN_PRESETS.filter((p) => p.patch.topology === 'fet');
        // Every FET preset must infer 'punch' (unless it has an explicit style).
        for (const preset of fet) {
            expect(preset.patch.style).toBe('punch');
        }
        // There must be at least one FET preset to exercise the branch.
        expect(fet.length).toBeGreaterThan(0);
    });

    it('opto topology presets map to smooth style', () => {
        const opto = GLUTEN_PRESETS.filter((p) => p.patch.topology === 'opto');
        for (const preset of opto) {
            expect(preset.patch.style).toBe('smooth');
        }
        expect(opto.length).toBeGreaterThan(0);
    });

    it('diode topology presets map to glue style', () => {
        const diode = GLUTEN_PRESETS.filter((p) => p.patch.topology === 'diode');
        for (const preset of diode) {
            expect(preset.patch.style).toBe('glue');
        }
        expect(diode.length).toBeGreaterThan(0);
    });

    it('vca topology presets (no explicit style) fall back to glue', () => {
        const vca = GLUTEN_PRESETS.filter((p) => p.patch.topology === 'vca' && p.id !== 'pump-edm');
        for (const preset of vca) {
            expect(preset.patch.style).toBe('glue');
        }
        expect(vca.length).toBeGreaterThan(0);
    });
});

describe('GLUTEN_PRESETS — explicit style override', () => {
    it('pump-edm preset has explicit pump style that overrides topology inference', () => {
        const pump = GLUTEN_PRESETS.find((p) => p.id === 'pump-edm')!;
        // topology is vca → would infer 'glue', but explicit style: 'pump' wins.
        expect(pump.patch.topology).toBe('vca');
        expect(pump.patch.style).toBe('pump');
    });

    it('no other preset leaks pump style (only pump-edm uses the explicit override)', () => {
        const pumpPresets = GLUTEN_PRESETS.filter((p) => p.patch.style === 'pump');
        expect(pumpPresets.map((p) => p.id)).toEqual(['pump-edm']);
    });
});

describe('GLUTEN_PRESETS — style never defaults to an invalid value', () => {
    it('every preset style is one of the four valid GlutenStyle values', () => {
        const validStyles = new Set(['glue', 'punch', 'smooth', 'pump']);
        for (const preset of GLUTEN_PRESETS) {
            expect(validStyles.has(preset.patch.style)).toBe(true);
        }
    });
});

describe('GLUTEN_PRESETS — topology coverage', () => {
    it('exercises all four topology values across the preset list', () => {
        const topologies = new Set(GLUTEN_PRESETS.map((p) => p.patch.topology));
        // All four topologies must be represented to fully exercise inferStyle.
        expect(topologies).toEqual(new Set(['vca', 'fet', 'opto', 'diode']));
    });
});
