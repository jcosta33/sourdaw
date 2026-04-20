import { describe, it, expect } from 'vitest';

import * as subject from '../stopAudioRecording';

describe('stopAudioRecording', () => {
    it('should export stopAudioRecording', () => {
        expect(subject.stopAudioRecording).toBeDefined();
        const t = typeof subject.stopAudioRecording;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
