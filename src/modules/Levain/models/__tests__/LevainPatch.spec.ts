import { describe, expect, it } from 'vitest';

import { ARTICULATION_ID_BY_TYPE } from '../LevainPatch';

describe('ARTICULATION_ID_BY_TYPE', () => {
    it('assigns every articulation a unique contiguous DSP id', () => {
        const ids = Object.values(ARTICULATION_ID_BY_TYPE);
        expect(ids).toEqual(Array.from({ length: ids.length }, (_, id) => id));
    });
});
