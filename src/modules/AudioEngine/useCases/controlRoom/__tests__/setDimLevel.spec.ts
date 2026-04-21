import { describe, it, expect } from 'vitest';

import * as subject from '../setDimLevel';

describe('setDimLevel', () => {
    it('should export setDimLevel', () => {
        expect(subject.setDimLevel).toBeDefined();
        const time = typeof subject.setDimLevel;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
