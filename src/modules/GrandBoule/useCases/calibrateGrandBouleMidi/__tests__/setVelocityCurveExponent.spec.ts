import { describe, it, expect } from 'vitest';
import * as subject from '../setVelocityCurveExponent';

describe('setVelocityCurveExponent', () => {
    it('should export setVelocityCurveExponent', () => {
        expect(subject.setVelocityCurveExponent).toBeDefined();
        const t = typeof subject.setVelocityCurveExponent;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
