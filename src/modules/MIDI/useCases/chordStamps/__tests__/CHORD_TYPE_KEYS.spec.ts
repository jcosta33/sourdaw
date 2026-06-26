import { describe, expect, it } from 'vitest';

import { CHORD_TYPES } from '../../../models/ChordTypes';
import { CHORD_TYPE_KEYS } from '../CHORD_TYPE_KEYS';

describe('CHORD_TYPE_KEYS', () => {
    it('contains every chord type key from CHORD_TYPES', () => {
        const fromObject = Object.keys(CHORD_TYPES).sort();
        const fromKeys = [...CHORD_TYPE_KEYS].sort();
        expect(fromKeys).toEqual(fromObject);
    });
});
