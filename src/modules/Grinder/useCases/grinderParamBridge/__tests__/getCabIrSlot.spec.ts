import { describe, expect, it } from 'vitest';

import { getCabIrSlot } from '../getCabIrSlot';

describe('getCabIrSlot', () => {
    it('should map cabinet IR ids to library slots', () => {
        expect(getCabIrSlot('4x12-tight')).toBe(0);
        expect(getCabIrSlot('2x12-open')).toBe(1);
        expect(getCabIrSlot('1x12-combo')).toBe(2);
    });

    it('should return null for unknown cabinet IR ids', () => {
        expect(getCabIrSlot('external-impulse')).toBeNull();
    });
});
