import { describe, it, expect } from 'vitest';
import * as subject from '../recordUsage';

describe('recordUsage', () => {
    it('should export recordUsage', () => {
        expect(subject.recordUsage).toBeDefined();
        const t = typeof subject.recordUsage;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
