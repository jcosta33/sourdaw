import { describe, it, expect } from 'vitest';
import * as subject from '../stopSamplerRecording';

describe('stopSamplerRecording', () => {
    it('should export stopSamplerRecording', () => {
        expect(subject.stopSamplerRecording).toBeDefined();
        const t = typeof subject.stopSamplerRecording;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
