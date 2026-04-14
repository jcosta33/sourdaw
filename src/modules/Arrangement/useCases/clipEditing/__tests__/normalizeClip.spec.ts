import { describe, it, expect } from 'vitest';
import * as subject from '../normalizeClip';

describe('normalizeClip', () => {
    it('should export normalizeClip', () => {
        expect(subject.normalizeClip).toBeDefined();
        const t = typeof subject.normalizeClip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
