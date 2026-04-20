import { describe, it, expect } from 'vitest';

import { isGlutenDevice } from '../GlutenNode';

describe('isGlutenDevice', () => {
    it('should return true only for the gluten device type string', () => {
        expect(isGlutenDevice('gluten')).toBe(true);
        expect(isGlutenDevice('levain')).toBe(false);
    });
});
