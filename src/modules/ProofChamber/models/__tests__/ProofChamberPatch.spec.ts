import { describe, it, expect } from 'vitest';

import infiniteSpacePatch from '../../../../../crates/proof-chamber/tests/fixtures/infinite_space_patch.json';
import {
    ALGORITHM_MAP,
    BOOLEAN_ENGINE_FIELDS,
    DEFAULT_PARAMS,
    NUMERIC_ENGINE_FIELDS,
    PARAM_MAP,
    SPACE_PRESETS,
    expandSpacePreset,
} from '../ProofChamberState';

describe('ProofChamberPatch constants', () => {
    it('should map every algorithm type to a distinct index', () => {
        const values = Object.values(ALGORITHM_MAP);
        expect(new Set(values).size).toBe(values.length);
    });

    it('should list a space preset entry for each SpaceType key', () => {
        const keys = Object.keys(SPACE_PRESETS) as Array<keyof typeof SPACE_PRESETS>;
        expect(keys.length).toBeGreaterThan(0);
        for (const kIndex of keys) {
            expect(SPACE_PRESETS[kIndex]).toBeDefined();
        }
    });

    it('should keep PARAM_MAP keys aligned with DEFAULT_PARAMS fields', () => {
        for (const key of Object.keys(PARAM_MAP)) {
            expect(key in DEFAULT_PARAMS || key === 'algorithm').toBe(true);
        }
    });

    it('should only use known algorithm labels in DEFAULT_PARAMS', () => {
        expect(Object.keys(ALGORITHM_MAP)).toContain(DEFAULT_PARAMS.algorithm);
    });
});

describe('expandSpacePreset', () => {
    it('overlays the space tuning onto the defaults and pins the space', () => {
        const result = expandSpacePreset('hall');
        expect(result).toEqual({ ...DEFAULT_PARAMS, ...SPACE_PRESETS.hall, space: 'hall', algorithm: 'plate' });
        // Spot-check that the space tuning actually won over the defaults.
        expect(result.size).toBe(SPACE_PRESETS.hall.size);
        expect(result.predelay).toBe(SPACE_PRESETS.hall.predelay);
    });

    it('defaults algorithm to the module default when the space sets none', () => {
        expect(expandSpacePreset('cathedral').algorithm).toBe('plate');
    });

    it('keeps the algorithm a space declares for itself', () => {
        // SPACE_PRESETS.spring sets algorithm: 'spring'.
        expect(expandSpacePreset('spring').algorithm).toBe('spring');
    });

    it('lets the Infinite space fill the tank before the user freezes it', () => {
        const expanded = expandSpacePreset('infinite');
        const parameters: Record<string, number> = {
            algorithm: ALGORITHM_MAP[expanded.algorithm],
        };
        for (const key of NUMERIC_ENGINE_FIELDS) {
            const paramId = PARAM_MAP[key];
            expect(paramId).toBeDefined();
            if (!paramId) {
                continue;
            }
            parameters[paramId] = expanded[key];
        }
        for (const key of BOOLEAN_ENGINE_FIELDS) {
            const paramId = PARAM_MAP[key];
            expect(paramId).toBeDefined();
            if (!paramId) {
                continue;
            }
            parameters[paramId] = expanded[key] ? 1 : 0;
        }

        expect({ space: expanded.space, parameters }).toEqual(infiniteSpacePatch);
    });
});
