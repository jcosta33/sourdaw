import { describe, it, expect } from 'vitest';

import { CRUST_OVERSAMPLE_FACTORS, DEFAULT_CRUST_PATCH } from '../../models/CrustPatch';
import { CRUST_PRESETS } from '../crustPresets';

describe('CRUST_PRESETS', () => {
    it('exposes a non-empty preset list', () => {
        expect(CRUST_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has a unique id, a non-empty name, and a matching patch name', () => {
        const ids = CRUST_PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const preset of CRUST_PRESETS) {
            expect(preset.id.length).toBeGreaterThan(0);
            expect(preset.name.length).toBeGreaterThan(0);
            expect(preset.category.length).toBeGreaterThan(0);
            expect(preset.patch.name).toBe(preset.name);
        }
    });

    it('every preset patch has numeric fields within documented ranges', () => {
        for (const preset of CRUST_PRESETS) {
            const patch = preset.patch;
            // gain: 0–18 dB
            expect(patch.gain).toBeGreaterThanOrEqual(0);
            expect(patch.gain).toBeLessThanOrEqual(18);
            // ceiling: -6 to 0 dBTP
            expect(patch.ceiling).toBeGreaterThanOrEqual(-6);
            expect(patch.ceiling).toBeLessThanOrEqual(0);
            // lookahead: 0–10 ms
            expect(patch.lookahead).toBeGreaterThanOrEqual(0);
            expect(patch.lookahead).toBeLessThanOrEqual(10);
            // channel link: 0–100 %
            expect(patch.channelLinkTransient).toBeGreaterThanOrEqual(0);
            expect(patch.channelLinkTransient).toBeLessThanOrEqual(100);
            expect(patch.channelLinkRelease).toBeGreaterThanOrEqual(0);
            expect(patch.channelLinkRelease).toBeLessThanOrEqual(100);
            // oversampling must be a factor the engine distinguishes. Read from
            // the model's list rather than a copy of it — the copy that used to
            // sit here was one of the three places 2x had gone missing.
            expect(CRUST_OVERSAMPLE_FACTORS).toContain(patch.oversampling);
            // crossovers in Hz
            expect(patch.crossover1).toBeGreaterThan(0);
            expect(patch.crossover2).toBeGreaterThan(0);
        }
    });

    it('each preset patch differs from the default init patch', () => {
        for (const preset of CRUST_PRESETS) {
            const snapshot = JSON.stringify({ ...preset.patch, name: 'Init' });
            const defaultSnapshot = JSON.stringify(DEFAULT_CRUST_PATCH);
            expect(snapshot).not.toBe(defaultSnapshot);
        }
    });
});
