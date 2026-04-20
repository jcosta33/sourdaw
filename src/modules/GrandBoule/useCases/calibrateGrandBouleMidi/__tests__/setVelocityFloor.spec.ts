import { describe, it, expect } from 'vitest';

import * as subject from '../setVelocityFloor';

describe('setVelocityFloor', () => {
    it('should export setVelocityFloor', () => {
        expect(subject.setVelocityFloor).toBeDefined();
        const t = typeof subject.setVelocityFloor;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
