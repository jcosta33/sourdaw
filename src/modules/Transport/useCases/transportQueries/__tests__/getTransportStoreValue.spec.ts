import { describe, it, expect } from 'vitest';
import * as subject from '../getTransportStoreValue';

describe('getTransportStoreValue', () => {
    it('should export getTransportStoreValue', () => {
        expect(subject.getTransportStoreValue).toBeDefined();
        const t = typeof subject.getTransportStoreValue;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
