import { describe, it, expect } from 'vitest';

import * as subject from '../decodeAudioFile';

describe('decodeAudioFile', () => {
    it('should export decodeAudioFile', () => {
        expect(subject.decodeAudioFile).toBeDefined();
        const t = typeof subject.decodeAudioFile;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
