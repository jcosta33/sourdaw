import { describe, it, expect } from 'vitest';
import * as subject from '../getCompensationDelay';

describe('getCompensationDelay', () => {
    it('should export getCompensationDelay', () => {
        expect(subject.getCompensationDelay).toBeDefined();
        const t = typeof subject.getCompensationDelay;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
