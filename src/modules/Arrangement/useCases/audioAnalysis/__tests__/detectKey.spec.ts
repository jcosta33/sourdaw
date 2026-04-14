import { describe, it, expect } from 'vitest';
import * as subject from '../detectKey';

describe('detectKey', () => {
    it('should export detectKey', () => {
        expect(subject.detectKey).toBeDefined();
        const t = typeof subject.detectKey;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
