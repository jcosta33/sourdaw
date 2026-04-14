import { describe, it, expect } from 'vitest';
import * as subject from '../loadGlutenPatchWithAudio';

describe('loadGlutenPatchWithAudio', () => {
    it('should export loadGlutenPatchWithAudio', () => {
        expect(subject.loadGlutenPatchWithAudio).toBeDefined();
        const t = typeof subject.loadGlutenPatchWithAudio;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
