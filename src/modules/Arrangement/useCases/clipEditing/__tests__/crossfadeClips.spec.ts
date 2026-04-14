import { describe, it, expect } from 'vitest';
import * as subject from '../crossfadeClips';

describe('crossfadeClips', () => {
    it('should export crossfadeClips', () => {
        expect(subject.crossfadeClips).toBeDefined();
        const t = typeof subject.crossfadeClips;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
