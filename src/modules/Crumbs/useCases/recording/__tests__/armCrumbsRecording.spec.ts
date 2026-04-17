import { describe, it, expect } from 'vitest';
import * as subject from '../armSamplerRecording';

describe('armSamplerRecording', () => {
    it('should export armSamplerRecording', () => {
        expect(subject.armSamplerRecording).toBeDefined();
        const t = typeof subject.armSamplerRecording;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
