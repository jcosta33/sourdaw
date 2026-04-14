import { describe, it, expect } from 'vitest';
import * as subject from '../setProofParam';

describe('setProofParam', () => {
    it('should export setProofParam', () => {
        expect(subject.setProofParam).toBeDefined();
        const t = typeof subject.setProofParam;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
