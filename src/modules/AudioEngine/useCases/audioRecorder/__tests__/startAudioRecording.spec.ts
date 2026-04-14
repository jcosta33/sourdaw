import { describe, it, expect } from 'vitest';
import * as subject from '../startAudioRecording';

describe('startAudioRecording', () => {
    it('should export startAudioRecording', () => {
        expect(subject.startAudioRecording).toBeDefined();
        const t = typeof subject.startAudioRecording;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
