import { describe, it, expect } from 'vitest';

import * as subject from '../startMacroRecording';

describe('startMacroRecording', () => {
    it('should export startMacroRecording', () => {
        expect(subject.startMacroRecording).toBeDefined();
        const time = typeof subject.startMacroRecording;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
