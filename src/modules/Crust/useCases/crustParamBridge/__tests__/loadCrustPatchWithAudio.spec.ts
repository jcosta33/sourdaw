import { describe, it, expect } from 'vitest';
import * as subject from '../loadCrustPatchWithAudio';

describe('loadCrustPatchWithAudio', () => {
    it('should export loadCrustPatchWithAudio', () => {
        expect(subject.loadCrustPatchWithAudio).toBeDefined();
        const t = typeof subject.loadCrustPatchWithAudio;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
