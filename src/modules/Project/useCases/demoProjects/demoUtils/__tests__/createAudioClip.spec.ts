import { describe, it, expect } from 'vitest';
import * as subject from '../createAudioClip';

describe('createAudioClip', () => {
    it('should export createAudioClip', () => {
        expect(subject.createAudioClip).toBeDefined();
        const t = typeof subject.createAudioClip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
