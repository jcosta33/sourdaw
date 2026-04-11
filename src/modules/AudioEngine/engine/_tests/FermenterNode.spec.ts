import { describe, it, expect } from 'vitest';
import { isFermenterDevice } from '../FermenterNode';

describe('isFermenterDevice', () => {
    it('should return true only for the fermenter device type string', () => {
        expect(isFermenterDevice('fermenter')).toBe(true);
        expect(isFermenterDevice('levain')).toBe(false);
    });
});
