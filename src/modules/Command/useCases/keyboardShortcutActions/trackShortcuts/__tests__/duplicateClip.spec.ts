import { describe, it, expect } from 'vitest';
import * as subject from '../duplicateClip';

describe('duplicateClip', () => {
    it('should export duplicateClip', () => {
        expect(subject.duplicateClip).toBeDefined();
        const t = typeof subject.duplicateClip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
