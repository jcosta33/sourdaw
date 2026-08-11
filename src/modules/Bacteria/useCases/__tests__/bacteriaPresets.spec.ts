import { describe, it, expect } from 'vitest';

import { BACTERIA_PRESETS } from '../bacteriaPresets';

describe('BACTERIA_PRESETS', () => {
    it('exposes a non-empty preset list', () => {
        expect(BACTERIA_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has a unique id, non-empty name/category, and a matching patch name', () => {
        const ids = BACTERIA_PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const preset of BACTERIA_PRESETS) {
            expect(preset.id.length).toBeGreaterThan(0);
            expect(preset.name.length).toBeGreaterThan(0);
            expect(preset.category.length).toBeGreaterThan(0);
            expect(preset.patch.name).toBe(preset.name);
        }
    });

    it('every preset patch has top-level fields within documented ranges', () => {
        for (const preset of BACTERIA_PRESETS) {
            const patch = preset.patch;
            // inputGain / outputGain: -24 to +24 dB
            expect(patch.inputGain).toBeGreaterThanOrEqual(-24);
            expect(patch.inputGain).toBeLessThanOrEqual(24);
            expect(patch.outputGain).toBeGreaterThanOrEqual(-24);
            expect(patch.outputGain).toBeLessThanOrEqual(24);
            // mix: 0–1
            expect(patch.mix).toBeGreaterThanOrEqual(0);
            expect(patch.mix).toBeLessThanOrEqual(1);
            // bandCount: 1–6
            expect(patch.bandCount).toBeGreaterThanOrEqual(1);
            expect(patch.bandCount).toBeLessThanOrEqual(6);
        }
    });

    it('active bands have drive/cutoff within documented ranges', () => {
        for (const preset of BACTERIA_PRESETS) {
            for (let i = 0; i < preset.patch.bandCount; i++) {
                const band = preset.patch.bands[i]!;
                // drive: 0–100
                expect(band.drive).toBeGreaterThanOrEqual(0);
                expect(band.drive).toBeLessThanOrEqual(100);
                // filterCutoff: 20–20000 Hz
                expect(band.filterCutoff).toBeGreaterThanOrEqual(20);
                expect(band.filterCutoff).toBeLessThanOrEqual(20000);
            }
        }
    });

    it('starts Frozen Texture unfrozen so its wet granular voice renders', () => {
        const preset = BACTERIA_PRESETS.find(({ id }) => id === 'bac-frozen-texture');

        expect(preset?.patch.bands[0]).toMatchObject({
            granularEnabled: true,
            grainSize: 120,
            grainDensity: 25,
            grainPosOffset: 100,
            grainPitch: 7,
            grainFreeze: false,
            grainMix: 0.8,
        });
    });
});
