import { describe, it, expect } from 'vitest';
import * as subject from '../helpers';

describe('helpers', () => {
    it('should export createFlushHandlers', () => {
        expect(subject.createFlushHandlers).toBeDefined();
        const t = typeof subject.createFlushHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export encodeCrustValue', () => {
        expect(subject.encodeCrustValue).toBeDefined();
        const t = typeof subject.encodeCrustValue;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
