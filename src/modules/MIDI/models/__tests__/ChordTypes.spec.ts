import { describe, expect, it } from 'vitest';

import { CHORD_TYPES } from '../ChordTypes';

describe('CHORD_TYPES', () => {
    it('keeps major and minor triads as expected interval stacks', () => {
        expect(CHORD_TYPES.major).toEqual([0, 4, 7]);
        expect(CHORD_TYPES.minor).toEqual([0, 3, 7]);
    });
});
