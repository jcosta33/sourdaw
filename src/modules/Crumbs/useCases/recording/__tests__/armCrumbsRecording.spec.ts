import { describe, it, expect } from 'vitest';
import * as subject from '../armCrumbsRecording';

describe('armCrumbsRecording', () => {
    it('should export armCrumbsRecording', () => {
        expect(subject.armCrumbsRecording).toBeDefined();
        const t = typeof subject.armCrumbsRecording;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
