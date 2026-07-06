import { describe, expect, it } from 'vitest';

import { getNeuralModelSlot } from '../getNeuralModelSlot';

describe('getNeuralModelSlot', () => {
    it('should map builtin neural model ids to library slots', () => {
        expect(getNeuralModelSlot('factory-amp-a')).toBe(0);
        expect(getNeuralModelSlot('factory-rig-b')).toBe(1);
        expect(getNeuralModelSlot('vintage-stack-c')).toBe(2);
    });

    it('should return null for unknown neural model ids', () => {
        expect(getNeuralModelSlot('imported-tight-rhythm')).toBeNull();
    });
});
