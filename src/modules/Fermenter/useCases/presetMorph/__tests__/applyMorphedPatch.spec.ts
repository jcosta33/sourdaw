import { describe, it, expect } from 'vitest';

import * as subject from '../applyMorphedPatch';

describe('applyMorphedPatch', () => {
    it('should export applyMorphedPatch', () => {
        expect(subject.applyMorphedPatch).toBeDefined();
        const t = typeof subject.applyMorphedPatch;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
