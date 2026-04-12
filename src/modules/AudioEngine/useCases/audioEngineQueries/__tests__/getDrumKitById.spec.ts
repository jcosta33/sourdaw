import { describe, it, expect } from 'vitest';

import { getDrumKitById } from '../getDrumKitById';

describe('getDrumKitById', () => {
    it('should return a mapped drum kit when the id exists', () => {
        const kit = getDrumKitById('factory-808');
        expect(kit).not.toBeNull();
        expect(kit?.id).toBe('factory-808');
        expect(kit?.name).toBe('808 Kit');
        expect(kit?.voices.length).toBeGreaterThan(0);
    });

    it('should return null for an unknown id', () => {
        expect(getDrumKitById('no-such-kit')).toBeNull();
    });
});
