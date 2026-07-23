import { describe, it, expect } from 'vitest';

import { DEFAULT_PATCH } from '../../models/ProofPatch';
import { PROOF_PRESETS } from '../proofPresets';

describe('PROOF_PRESETS', () => {
    it('exposes a non-empty preset list', () => {
        expect(PROOF_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has a unique id, non-empty name/category, and a matching patch name', () => {
        const ids = PROOF_PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const preset of PROOF_PRESETS) {
            expect(preset.id.length).toBeGreaterThan(0);
            expect(preset.name.length).toBeGreaterThan(0);
            expect(preset.category.length).toBeGreaterThan(0);
            expect(preset.patch.name).toBe(preset.name);
        }
    });

    it('stamps every preset patch with a presetId matching the preset id', () => {
        for (const preset of PROOF_PRESETS) {
            expect(preset.patch.presetId).toBe(preset.id);
        }
    });

    it('every preset patch has mastering fields within documented ranges', () => {
        for (const preset of PROOF_PRESETS) {
            const patch = preset.patch;
            // inputGain / outputGain: -24 to 24 dB (from PROOF_PATCH_RANGES)
            expect(patch.inputGain).toBeGreaterThanOrEqual(-24);
            expect(patch.inputGain).toBeLessThanOrEqual(24);
            expect(patch.outputGain).toBeGreaterThanOrEqual(-24);
            expect(patch.outputGain).toBeLessThanOrEqual(24);
            // limCeiling: -12 to 0 dB
            expect(patch.limCeiling).toBeGreaterThanOrEqual(-12);
            expect(patch.limCeiling).toBeLessThanOrEqual(0);
            // limRelease: 10–500 ms
            expect(patch.limRelease).toBeGreaterThanOrEqual(10);
            expect(patch.limRelease).toBeLessThanOrEqual(500);
            // limLookahead: 0.5–10 ms
            expect(patch.limLookahead).toBeGreaterThanOrEqual(0.5);
            expect(patch.limLookahead).toBeLessThanOrEqual(10);
            // targetLufs: -60 to 0
            expect(patch.targetLufs).toBeGreaterThanOrEqual(-60);
            expect(patch.targetLufs).toBeLessThanOrEqual(0);
            // dynCrossoverFreqs: 3 frequencies in [20, 20000]
            expect(patch.dynCrossoverFreqs).toHaveLength(3);
            for (const freq of patch.dynCrossoverFreqs) {
                expect(freq).toBeGreaterThanOrEqual(20);
                expect(freq).toBeLessThanOrEqual(20000);
            }
            // imgMonoBassFreq: 40–200 Hz
            expect(patch.imgMonoBassFreq).toBeGreaterThanOrEqual(40);
            expect(patch.imgMonoBassFreq).toBeLessThanOrEqual(200);
        }
    });

    it('each preset patch differs from the default init patch', () => {
        for (const preset of PROOF_PRESETS) {
            const snapshot = JSON.stringify({ ...preset.patch, name: 'Init', presetId: undefined });
            const defaultSnapshot = JSON.stringify({ ...DEFAULT_PATCH, name: 'Init', presetId: undefined });
            expect(snapshot).not.toBe(defaultSnapshot);
        }
    });
});
