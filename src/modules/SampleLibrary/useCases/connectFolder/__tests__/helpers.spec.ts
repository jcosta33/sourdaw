import { describe, it, expect } from 'vitest';
import * as subject from '../helpers';

describe('helpers', () => {
    it('should export getScanAbortController', () => {
        expect(subject.getScanAbortController).toBeDefined();
        const t = typeof subject.getScanAbortController;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export setScanAbortController', () => {
        expect(subject.setScanAbortController).toBeDefined();
        const t = typeof subject.setScanAbortController;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
