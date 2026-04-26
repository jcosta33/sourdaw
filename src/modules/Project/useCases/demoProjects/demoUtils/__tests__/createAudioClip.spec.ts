import { describe, it, expect } from 'vitest';

import * as subject from '../createAudioClip';

describe('createAudioClip', () => {
    it('should export createAudioClip', () => {
        expect(subject.createAudioClip).toBeDefined();
        const time = typeof subject.createAudioClip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
