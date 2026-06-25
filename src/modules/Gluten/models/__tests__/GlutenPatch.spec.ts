import { describe, it, expect } from 'vitest';

import * as GlutenPatchModule from '../GlutenPatch';
import { clampOversampling, OVERSAMPLING_FACTORS, DEFAULT_PATCH } from '../GlutenPatch';

describe('clampOversampling', () => {
    // Fix 3 — the OS control (a step-1 knob over 1..4) could emit the unsupported
    // value 3. The engine only implements 1×/2×/4×; clampOversampling snaps any
    // input onto a supported factor so 3 can never reach the store or the engine.
    it('should snap the invalid factor 3 down to the supported 2', () => {
        expect(clampOversampling(3)).toBe(2);
    });

    it('should pass the supported factors 1, 2, and 4 through unchanged', () => {
        expect(clampOversampling(1)).toBe(1);
        expect(clampOversampling(2)).toBe(2);
        expect(clampOversampling(4)).toBe(4);
    });

    it('should clamp out-of-range values into the supported factor set', () => {
        expect(clampOversampling(0)).toBe(1);
        expect(clampOversampling(-5)).toBe(1);
        expect(clampOversampling(8)).toBe(4);
    });

    it('should only ever return a member of OVERSAMPLING_FACTORS', () => {
        for (let value = -2; value <= 6; value += 1) {
            expect(OVERSAMPLING_FACTORS).toContain(clampOversampling(value));
        }
    });

    it('should default the patch to a supported oversampling factor', () => {
        expect(OVERSAMPLING_FACTORS).toContain(DEFAULT_PATCH.oversampling);
    });
});

describe('GlutenPatch module surface', () => {
    // Fix 4 — the dead in-module GLUTEN_PARAMS registry (and its GlutenParamDef
    // type) had zero callers and duplicated the live Arrangement descriptor. It
    // was removed; this guards against it being reintroduced as dead weight.
    it('should not re-export the removed GLUTEN_PARAMS registry', () => {
        expect('GLUTEN_PARAMS' in GlutenPatchModule).toBe(false);
    });
});
