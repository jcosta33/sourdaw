import { describe, it, expect } from 'vitest';

import { isBacteriaDevice } from '../BacteriaNode';

describe('isBacteriaDevice', () => {
    it('should return true only for the bacteria device type string', () => {
        expect(isBacteriaDevice('bacteria')).toBe(true);
        expect(isBacteriaDevice('gluten')).toBe(false);
    });
});
