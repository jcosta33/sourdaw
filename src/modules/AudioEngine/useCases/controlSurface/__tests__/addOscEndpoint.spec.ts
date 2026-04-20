import { describe, it, expect } from 'vitest';

import * as subject from '../addOscEndpoint';

describe('addOscEndpoint', () => {
    it('should export addOscEndpoint', () => {
        expect(subject.addOscEndpoint).toBeDefined();
        const t = typeof subject.addOscEndpoint;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
