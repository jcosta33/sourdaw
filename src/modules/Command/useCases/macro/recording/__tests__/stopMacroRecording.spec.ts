import { describe, it, expect } from 'vitest';
import * as subject from '../stopMacroRecording';

describe('stopMacroRecording', () => {
    it('should export stopMacroRecording', () => {
        expect(subject.stopMacroRecording).toBeDefined();
        const t = typeof subject.stopMacroRecording;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
