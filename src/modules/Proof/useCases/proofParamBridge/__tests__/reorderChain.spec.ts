import { describe, it, expect } from 'vitest';
import * as subject from '../reorderChain';

describe('reorderChain', () => {
    it('should export reorderChain', () => {
        expect(subject.reorderChain).toBeDefined();
        const t = typeof subject.reorderChain;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
