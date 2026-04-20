import { describe, it, expect } from 'vitest';

import * as subject from '../setGrandBouleVelocityCurve';

describe('setGrandBouleVelocityCurve', () => {
    it('should export setGrandBouleVelocityCurve', () => {
        expect(subject.setGrandBouleVelocityCurve).toBeDefined();
        const t = typeof subject.setGrandBouleVelocityCurve;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
