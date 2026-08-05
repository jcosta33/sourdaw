import { describe, expect, it } from 'vitest';

import { snapToDeclaredLegalValue } from '../snapToDeclaredLegalValue';

describe('snapToDeclaredLegalValue', () => {
    it('floors onto the greatest member at or below the value', () => {
        // 30 is 2 away from 32 and 14 away from 16 — the floor still wins,
        // because the engines that declare these sets resolve downward
        // (`crates/daw-dsp/src/crust/oversample.rs` `normalize_factor`).
        const result = snapToDeclaredLegalValue({ legalValues: [1, 2, 4, 8, 16, 32], value: 30 });
        expect(result).toBe(16);
    });

    it('delivers a declared member as itself and the smallest member below the set', () => {
        expect(snapToDeclaredLegalValue({ legalValues: [1, 2, 4, 8, 16, 32], value: 4 })).toBe(4);
        expect(snapToDeclaredLegalValue({ legalValues: [1, 2, 4, 8, 16, 32], value: 0.4 })).toBe(1);
    });
});
