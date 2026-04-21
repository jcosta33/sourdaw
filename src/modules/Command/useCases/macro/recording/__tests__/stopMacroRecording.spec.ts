import { describe, it, expect } from 'vitest';

import * as subject from '../stopMacroRecording';

describe('stopMacroRecording', () => {
    it('should export stopMacroRecording', () => {
        expect(subject.stopMacroRecording).toBeDefined();
        const time = typeof subject.stopMacroRecording;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
