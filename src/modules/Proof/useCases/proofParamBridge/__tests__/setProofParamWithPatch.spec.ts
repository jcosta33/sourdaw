import { describe, it, expect } from 'vitest';
import * as subject from '../setProofParamWithPatch';

describe('setProofParamWithPatch', () => {
    it('should export setProofParamWithPatch', () => {
        expect(subject.setProofParamWithPatch).toBeDefined();
        const t = typeof subject.setProofParamWithPatch;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
