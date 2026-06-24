import { describe, it, expect } from 'vitest';

import { PROOF_PRESETS } from '../proofPresets';

describe('PROOF_PRESETS', () => {
    it('exposes a non-empty preset list', () => {
        expect(PROOF_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has id, name, category, and a patch', () => {
        for (const preset of PROOF_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(preset.name).toBeTruthy();
            expect(preset.category).toBeTruthy();
            expect(preset.patch).toBeDefined();
            expect(preset.patch.name).toBe(preset.name);
        }
    });

    it('preset ids are unique', () => {
        const ids = PROOF_PRESETS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    // ── Fix 4: each preset patch carries its preset id as a stable identity ──
    it('stamps every preset patch with a presetId matching the preset id', () => {
        for (const preset of PROOF_PRESETS) {
            expect(preset.patch.presetId).toBe(preset.id);
        }
    });
});
