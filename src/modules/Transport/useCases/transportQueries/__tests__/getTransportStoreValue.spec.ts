import { describe, it, expect } from 'vitest';

import * as subject from '../getTransportStoreValue';

describe('getTransportStoreValue', () => {
    it('should export getTransportStoreValue', () => {
        expect(subject.getTransportStoreValue).toBeDefined();
        const time = typeof subject.getTransportStoreValue;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
