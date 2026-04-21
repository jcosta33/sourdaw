import { describe, it, expect } from 'vitest';

import * as subject from '../importAudioFile';

describe('importAudioFile', () => {
    it('should export importAudioFile', () => {
        expect(subject.importAudioFile).toBeDefined();
        const time = typeof subject.importAudioFile;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
