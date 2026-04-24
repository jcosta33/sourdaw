import { describe, it, expect } from 'vitest';

import * as subject from '../createAlternativeClips';

describe('createAlternativeClips', () => {
    it('should export createAlternativeClips', () => {
        expect(subject.createAlternativeClips).toBeDefined();
        const time = typeof subject.createAlternativeClips;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
