import { describe, it, expect } from 'vitest';

import { DEFAULT_PATCH } from '../../models/GrinderPatch';
import { GRINDER_PRESETS } from '../grinderPresets';

describe('GRINDER_PRESETS', () => {
    it('exposes a non-empty preset list', () => {
        expect(GRINDER_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has a unique id, non-empty name/category, and a matching patch name', () => {
        const ids = GRINDER_PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const preset of GRINDER_PRESETS) {
            expect(preset.id.length).toBeGreaterThan(0);
            expect(preset.name.length).toBeGreaterThan(0);
            expect(preset.category.length).toBeGreaterThan(0);
            expect(preset.patch.name).toBe(preset.name);
        }
    });

    it('every preset patch has EQ/master fields within the 0–10 range', () => {
        for (const preset of GRINDER_PRESETS) {
            const patch = preset.patch;
            for (const value of [patch.bass, patch.mid, patch.treble, patch.presence, patch.resonance, patch.master]) {
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(10);
            }
            // gain in dB (non-negative push)
            expect(patch.gain).toBeGreaterThanOrEqual(0);
            // sagAmount: 0–1
            expect(patch.sagAmount).toBeGreaterThanOrEqual(0);
            expect(patch.sagAmount).toBeLessThanOrEqual(1);
        }
    });

    it('includes a dedicated metal preset with gate and front-end drive support', () => {
        const metalPresets = GRINDER_PRESETS.filter((preset) => preset.category === 'Metal');
        expect(metalPresets.length).toBeGreaterThan(0);
        for (const preset of metalPresets) {
            expect(preset.patch.gateEnabled).toBe(true);
            expect(preset.patch.channel).toBe(2);
            expect(preset.patch.prePedals.some((pedal) => pedal.type === 'overdrive' && pedal.enabled)).toBe(true);
        }
    });

    it('each preset patch differs from the default init patch', () => {
        for (const preset of GRINDER_PRESETS) {
            const snapshot = JSON.stringify({ ...preset.patch, name: 'Init' });
            const defaultSnapshot = JSON.stringify({ ...DEFAULT_PATCH, name: 'Init' });
            expect(snapshot).not.toBe(defaultSnapshot);
        }
    });
});
