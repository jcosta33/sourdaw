import { describe, it, expect } from 'vitest';

import { getCabIrSlot } from '../getCabIrSlot';

describe('getCabIrSlot', () => {
    it('returns slot index for valid id', () => {
        const result = getCabIrSlot('invalid-id');
        expect(result).toBeNull();
    });
});
