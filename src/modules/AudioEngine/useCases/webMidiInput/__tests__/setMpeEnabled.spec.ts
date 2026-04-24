import { describe, it, expect } from 'vitest';

import * as subject from '../setMpeEnabled';

describe('setMpeEnabled', () => {
    it('should export setMpeEnabled', () => {
        expect(subject.setMpeEnabled).toBeDefined();
        const time = typeof subject.setMpeEnabled;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
