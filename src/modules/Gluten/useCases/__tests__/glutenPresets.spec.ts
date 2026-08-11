import { describe, it, expect } from 'vitest';

import { DEFAULT_PATCH, type GlutenPatch } from '../../models/GlutenPatch';
import { glutenControlGate } from '../../models/GlutenTopologyGating';
import { GLUTEN_PRESETS } from '../glutenPresets';

/**
 * The neutral — "not engaged" — value of every switch that is not a boolean.
 *
 * Two of them, and both had to be declared rather than inferred, because "off"
 * is not zero for either: `oversampling`'s off is **1×**, meaning no
 * oversampling at all, and `thrust`'s is 0.
 *
 * `oversampling` is the reason this file's population is now derived. The first
 * version listed twelve names from memory and tested `value !== 0`, which
 * excluded `oversampling` twice over — it was not in the list, and 1× would not
 * have counted as neutral if it had been. `DEFAULT_PATCH.oversampling` was `2`
 * on a `vca` default, so a freshly inserted device rendered the 2× chip lit and
 * greyed, claiming an oversampled path that does not run, with the click back
 * to 1× refused.
 */
const NON_BOOLEAN_NEUTRALS: Partial<Record<keyof GlutenPatch, number>> = {
    thrust: 0,
    oversampling: 1,
};

/**
 * Every key of `DEFAULT_PATCH` that holds a boolean — a switch by construction,
 * whose neutral is always `false`.
 *
 * Derived rather than listed so a switch added to the patch joins the
 * population with no edit here, which is what a list from memory cannot do.
 */
function booleanPatchKeys(): (keyof GlutenPatch)[] {
    return (Object.keys(DEFAULT_PATCH) as (keyof GlutenPatch)[]).filter(
        (paramKey) => typeof DEFAULT_PATCH[paramKey] === 'boolean'
    );
}

/**
 * Switches that a patch can ship *engaged* — the ones where shipping a value
 * the topology cannot hear leaves a control lit and unclearable. Detector-chain
 * controls are valid on every topology and therefore are not rejected here.
 *
 * **Known gap, recorded rather than papered over:** `blendAmount` and
 * `blendTopology` are a *pair* — Stage 2 above zero is only meaningful together
 * with a topology that differs from the primary — and a per-key neutral cannot
 * express a two-key invariant. The panel's `overridden` gate covers the user
 * -facing half of it (`blendAmount` greys when both stages name one topology);
 * nothing here would catch a preset that shipped the pair inconsistently.
 */
const ENGAGEABLE: readonly (keyof GlutenPatch)[] = [
    ...booleanPatchKeys(),
    ...(Object.keys(NON_BOOLEAN_NEUTRALS) as (keyof GlutenPatch)[]),
];

function isEngaged(patch: GlutenPatch, paramKey: keyof GlutenPatch): boolean {
    const value = patch[paramKey];
    if (typeof value === 'boolean') {
        return value;
    }
    return value !== NON_BOOLEAN_NEUTRALS[paramKey];
}

describe('the engaged-switch population', () => {
    it('is derived from the patch rather than remembered', () => {
        // The vacuity guard. Replacing `ENGAGEABLE` with `[]` left all fifteen
        // rows below green, which is what let `oversampling` sit outside the
        // population unnoticed.
        expect(ENGAGEABLE.length).toBeGreaterThan(0);

        const covered = new Set(ENGAGEABLE.map(String));
        expect(booleanPatchKeys().filter((paramKey) => !covered.has(String(paramKey)))).toEqual([]);
    });

    it('declares a neutral only for switches that are not booleans', () => {
        // A boolean listed here would get a numeric neutral it can never equal,
        // making `isEngaged` always true for it.
        const misfiled = (Object.keys(NON_BOOLEAN_NEUTRALS) as (keyof GlutenPatch)[]).filter(
            (paramKey) => typeof DEFAULT_PATCH[paramKey] === 'boolean'
        );
        expect(misfiled).toEqual([]);
    });
});

describe('a preset never ships a value its own topology cannot hear', () => {
    /** Checked against every preset and the default patch. */
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
