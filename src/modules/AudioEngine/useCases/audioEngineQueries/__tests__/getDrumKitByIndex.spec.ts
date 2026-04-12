import { describe, it, expect } from 'vitest';

import { getDrumKitByIndex } from '../getDrumKitByIndex';

describe('getDrumKitByIndex', () => {
    it('should return the first factory kit at index zero', () => {
        const kit = getDrumKitByIndex(0);
        expect(kit?.id).toBe('factory-808');
    });

    it('should return null when the index is out of range', () => {
        expect(getDrumKitByIndex(999)).toBeNull();
    });
});
