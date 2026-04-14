import { describe, it, expect } from 'vitest';
import * as subject from '../denoiseAudio';

describe('denoiseAudio', () => {
    it('should export denoiseAudio', () => {
        expect(subject.denoiseAudio).toBeDefined();
        const t = typeof subject.denoiseAudio;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
