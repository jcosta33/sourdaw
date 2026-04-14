import { describe, it, expect } from 'vitest';
import * as subject from '../importAudioFile';

describe('importAudioFile', () => {
    it('should export importAudioFile', () => {
        expect(subject.importAudioFile).toBeDefined();
        const t = typeof subject.importAudioFile;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
