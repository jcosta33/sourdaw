import { describe, it, expect } from 'vitest';

import * as subject from '../decodeAudioFile';

describe('decodeAudioFile', () => {
    it('should export decodeAudioFile', () => {
        expect(subject.decodeAudioFile).toBeDefined();
        const time = typeof subject.decodeAudioFile;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
