import { describe, it, expect } from 'vitest';

import * as subject from '../setMpeEnabled';

describe('setMpeEnabled', () => {
    it('should export setMpeEnabled', () => {
        expect(subject.setMpeEnabled).toBeDefined();
        const t = typeof subject.setMpeEnabled;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
