import { describe, it, expect } from 'vitest';

import * as subject from '../startMacroRecording';

describe('startMacroRecording', () => {
    it('should export startMacroRecording', () => {
        expect(subject.startMacroRecording).toBeDefined();
        const t = typeof subject.startMacroRecording;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
