import { describe, it, expect } from 'vitest';

import * as subject from '../setSnapValue';

describe('setSnapValue', () => {
    it('should export setSnapValue', () => {
        expect(subject.setSnapValue).toBeDefined();
        const time = typeof subject.setSnapValue;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
