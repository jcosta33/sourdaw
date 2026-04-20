import { describe, it, expect } from 'vitest';

import { ALGORITHM_MAP, DEFAULT_PARAMS, PARAM_MAP, SPACE_PRESETS } from '../ProofChamberState';

describe('ProofChamberPatch constants', () => {
    it('should map every algorithm type to a distinct index', () => {
        const values = Object.values(ALGORITHM_MAP);
        expect(new Set(values).size).toBe(values.length);
    });

    it('should list a space preset entry for each SpaceType key', () => {
        const keys = Object.keys(SPACE_PRESETS) as Array<keyof typeof SPACE_PRESETS>;
        expect(keys.length).toBeGreaterThan(0);
        for (const k of keys) {
            expect(SPACE_PRESETS[k]).toBeDefined();
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
