import { describe, it, expect } from 'vitest';
import * as subject from '../removeOscEndpoint';

describe('removeOscEndpoint', () => {
    it('should export removeOscEndpoint', () => {
        expect(subject.removeOscEndpoint).toBeDefined();
        const t = typeof subject.removeOscEndpoint;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
