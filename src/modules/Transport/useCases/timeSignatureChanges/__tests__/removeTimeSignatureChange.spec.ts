import { describe, it, expect } from 'vitest';
import * as subject from '../removeTimeSignatureChange';

describe('removeTimeSignatureChange', () => {
    it('should export removeTimeSignatureChange', () => {
        expect(subject.removeTimeSignatureChange).toBeDefined();
        const t = typeof subject.removeTimeSignatureChange;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
