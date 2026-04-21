import { describe, it, expect } from 'vitest';

import * as subject from '../startAudioRecording';

describe('startAudioRecording', () => {
    it('should export startAudioRecording', () => {
        expect(subject.startAudioRecording).toBeDefined();
        const time = typeof subject.startAudioRecording;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
