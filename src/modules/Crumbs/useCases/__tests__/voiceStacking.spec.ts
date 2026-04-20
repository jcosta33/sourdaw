import { describe, it, expect } from 'vitest';

import * as subject from '../voiceStacking';

describe('voiceStacking', () => {
    it('should export updateVoiceStack', () => {
        expect(subject.updateVoiceStack).toBeDefined();
        const t = typeof subject.updateVoiceStack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
