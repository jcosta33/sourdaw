import { describe, it, expect } from 'vitest';

import { DEFAULT_PATCH, type GlutenPatch } from '../../models/GlutenPatch';
import { glutenControlGate } from '../../models/GlutenTopologyGating';
import { GLUTEN_PRESETS } from '../glutenPresets';

/**
 * Switches that a patch can ship *engaged* — the ones where shipping a value
 * the topology cannot hear leaves a control lit and, since the panel gates it,
 * unclearable.
 *
 * `thrust` is here as a three-position chip whose neutral is 0; the rest are
 * booleans whose neutral is false. A *frequency* on a filter whose stage is not
 * running is deliberately not policed: it is the preset's stated intent and
 * becomes correct the moment the topology can hear it, which is why the Master
 * presets keep `scHpfFreq` and lost `scHpfEnabled`.
 */
const ENGAGEABLE: readonly (keyof GlutenPatch)[] = [
    'scHpfEnabled',
    'scLpfEnabled',
    'scEqEnabled',
    'extSidechain',
    'thrust',
    'autoRelease',
    'autoMakeup',
    'deltaListen',
    'gainMatchBypass',
    'allButtons',
    'limitMode',
    'feedForward',
];

function isEngaged(patch: GlutenPatch, paramKey: keyof GlutenPatch): boolean {
    const value = patch[paramKey];
    if (typeof value === 'boolean') {
        return value;
    }
    return value !== 0;
}

describe('a preset never ships a value its own topology cannot hear', () => {
    /**
     * `Loud Master` shipped `thrust: 2` on a VCA preset, and both Master
     * presets shipped `scHpfEnabled: true` — all three on a topology whose
     * detector never sees the sidechain chain. Latent before this PR (the
     * controls did nothing and the user could clear them); load-bearing after
     * it, because the gate refuses the click that would clear them. Worse, a
     * diode Stage two would then drive the detector at Thrust *loud*, a setting
     * the user never chose.
     *
     * The rule is checked against every preset rather than the two that were
     * wrong, and against the default patch, which had the same flag.
     */
    const CASES: readonly (readonly [string, GlutenPatch])[] = [
        ...GLUTEN_PRESETS.map((preset) => [preset.name, preset.patch] as const),
        ['Init (the default patch)', DEFAULT_PATCH] as const,
    ];

    it.each(CASES)('%s', (_name, patch) => {
        const engagedButInert = ENGAGEABLE.filter((paramKey) => {
            if (!isEngaged(patch, paramKey)) {
                return false;
            }
            return glutenControlGate({ patch, paramKey, controlLabel: String(paramKey) }).isInert;
        }).map(String);

        expect(engagedButInert).toEqual([]);
    });
});

describe('GLUTEN_PRESETS', () => {
    it('exposes a non-empty preset list', () => {
        expect(GLUTEN_PRESETS.length).toBeGreaterThan(0);
    });

    it('every preset has a unique id, non-empty name/category, and a matching patch name', () => {
        const ids = GLUTEN_PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const preset of GLUTEN_PRESETS) {
            expect(preset.id.length).toBeGreaterThan(0);
            expect(preset.name.length).toBeGreaterThan(0);
            expect(preset.category.length).toBeGreaterThan(0);
            expect(preset.patch.name).toBe(preset.name);
        }
    });

    it('every preset patch has compressor fields within documented ranges', () => {
        for (const preset of GLUTEN_PRESETS) {
            const patch = preset.patch;
            // threshold: -60 to 0 dB
            expect(patch.threshold).toBeGreaterThanOrEqual(-60);
            expect(patch.threshold).toBeLessThanOrEqual(0);
            // ratio: 1–20
            expect(patch.ratio).toBeGreaterThanOrEqual(1);
            expect(patch.ratio).toBeLessThanOrEqual(20);
            // attack: 0.02–250 ms
            expect(patch.attack).toBeGreaterThanOrEqual(0.02);
            expect(patch.attack).toBeLessThanOrEqual(250);
            // release: 25–5000 ms
            expect(patch.release).toBeGreaterThanOrEqual(25);
            expect(patch.release).toBeLessThanOrEqual(5000);
            // knee: 0–30 dB
            expect(patch.knee).toBeGreaterThanOrEqual(0);
            expect(patch.knee).toBeLessThanOrEqual(30);
            // mix: 0–1
            expect(patch.mix).toBeGreaterThanOrEqual(0);
            expect(patch.mix).toBeLessThanOrEqual(1);
        }
    });

    it('presets span more than one category', () => {
        const categories = new Set(GLUTEN_PRESETS.map((preset) => preset.category));
        expect(categories.size).toBeGreaterThan(1);
    });
});
