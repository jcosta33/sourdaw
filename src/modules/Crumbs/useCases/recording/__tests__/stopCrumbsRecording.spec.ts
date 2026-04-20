import { describe, it, expect } from 'vitest';
import * as subject from '../stopCrumbsRecording';

describe('stopCrumbsRecording', () => {
    it('should export stopCrumbsRecording', () => {
        expect(subject.stopCrumbsRecording).toBeDefined();
        const t = typeof subject.stopCrumbsRecording;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
