import { describe, it, expect } from 'vitest';

import * as subject from '../createNebulaDriftDemo';

describe('createNebulaDriftDemo', () => {
    it('should export demo5_NebulaDrift', () => {
        expect(subject.demo5_NebulaDrift).toBeDefined();
        const t = typeof subject.demo5_NebulaDrift;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
