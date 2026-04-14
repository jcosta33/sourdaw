import { describe, it, expect } from 'vitest';
import * as subject from '../getVersionControlHandlers';

describe('getVersionControlHandlers', () => {
    it('should export getVersionControlHandlers', () => {
        expect(subject.getVersionControlHandlers).toBeDefined();
        const t = typeof subject.getVersionControlHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
