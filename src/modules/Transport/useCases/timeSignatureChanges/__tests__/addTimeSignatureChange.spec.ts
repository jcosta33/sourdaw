import { describe, it, expect } from 'vitest';
import * as subject from '../addTimeSignatureChange';

describe('addTimeSignatureChange', () => {
    it('should export addTimeSignatureChange', () => {
        expect(subject.addTimeSignatureChange).toBeDefined();
        const t = typeof subject.addTimeSignatureChange;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
