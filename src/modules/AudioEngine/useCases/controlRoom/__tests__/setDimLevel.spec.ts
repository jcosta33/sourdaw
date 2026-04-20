import { describe, it, expect } from 'vitest';

import * as subject from '../setDimLevel';

describe('setDimLevel', () => {
    it('should export setDimLevel', () => {
        expect(subject.setDimLevel).toBeDefined();
        const t = typeof subject.setDimLevel;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
