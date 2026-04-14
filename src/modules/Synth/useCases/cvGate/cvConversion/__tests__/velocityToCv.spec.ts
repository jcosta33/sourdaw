import { describe, it, expect } from 'vitest';
import { velocityToCv } from '../velocityToCv';

describe('velocityToCv', () => {
    it('should scale velocity 0–127 to 0–maxVoltage', () => {
        expect(velocityToCv(127, 5)).toBe(5);
        expect(velocityToCv(0, 5)).toBe(0);
    });

    it('should default max voltage to 5', () => {
        expect(velocityToCv(127)).toBe(5);
    });
});
