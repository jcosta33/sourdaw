import { describe, it, expect } from 'vitest';

import * as subject from '../createNebulaDriftDemo';

describe('createNebulaDriftDemo', () => {
    it('should export demo5_NebulaDrift', () => {
        expect(subject.demo5_NebulaDrift).toBeDefined();
        const time = typeof subject.demo5_NebulaDrift;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
