import { describe, it, expect } from 'vitest';
import * as subject from '../setVelocityCeiling';

describe('setVelocityCeiling', () => {
    it('should export setVelocityCeiling', () => {
        expect(subject.setVelocityCeiling).toBeDefined();
        const t = typeof subject.setVelocityCeiling;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
