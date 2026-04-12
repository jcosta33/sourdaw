import { describe, it, expect } from 'vitest';
import { isLevainDevice } from '../LevainNode';

describe('isLevainDevice', () => {
    it('should return true only for the levain device type string', () => {
        expect(isLevainDevice('levain')).toBe(true);
        expect(isLevainDevice('fermenter')).toBe(false);
        expect(isLevainDevice('')).toBe(false);
    });
});
