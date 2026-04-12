import { describe, expect, it } from 'vitest';

import { CHORD_TYPES } from '../helpers';

describe('CHORD_TYPES', () => {
    it('defines semitone offsets from the root for common qualities', () => {
        expect(CHORD_TYPES.major).toEqual([0, 4, 7]);
        expect(CHORD_TYPES.minor).toEqual([0, 3, 7]);
        expect(CHORD_TYPES.dim).toEqual([0, 3, 6]);
        expect(CHORD_TYPES['7']).toEqual([0, 4, 7, 10]);
    });
});
