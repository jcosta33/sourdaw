import { describe, it, expect } from 'vitest';

import * as subject from '../createAlternativeClips';

describe('createAlternativeClips', () => {
    it('should export createAlternativeClips', () => {
        expect(subject.createAlternativeClips).toBeDefined();
        const t = typeof subject.createAlternativeClips;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
