import { describe, it, expect } from 'vitest';

import * as subject from '../denoiseAudio';

describe('denoiseAudio', () => {
    it('should export denoiseAudio', () => {
        expect(subject.denoiseAudio).toBeDefined();
        const time = typeof subject.denoiseAudio;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
