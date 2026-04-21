import { describe, it, expect } from 'vitest';

import * as subject from '../removeOscEndpoint';

describe('removeOscEndpoint', () => {
    it('should export removeOscEndpoint', () => {
        expect(subject.removeOscEndpoint).toBeDefined();
        const time = typeof subject.removeOscEndpoint;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
