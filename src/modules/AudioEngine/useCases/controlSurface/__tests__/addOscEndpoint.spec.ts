import { describe, it, expect } from 'vitest';

import * as subject from '../addOscEndpoint';

describe('addOscEndpoint', () => {
    it('should export addOscEndpoint', () => {
        expect(subject.addOscEndpoint).toBeDefined();
        const time = typeof subject.addOscEndpoint;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
