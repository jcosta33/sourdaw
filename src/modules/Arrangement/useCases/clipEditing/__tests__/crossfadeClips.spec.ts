import { describe, it, expect } from 'vitest';

import * as subject from '../crossfadeClips';

describe('crossfadeClips', () => {
    it('should export crossfadeClips', () => {
        expect(subject.crossfadeClips).toBeDefined();
        const time = typeof subject.crossfadeClips;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
