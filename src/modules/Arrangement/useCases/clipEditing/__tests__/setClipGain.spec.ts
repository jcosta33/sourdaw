import { describe, it, expect } from 'vitest';
import * as subject from '../setClipGain';

describe('setClipGain', () => {
    it('should export setClipGain', () => {
        expect(subject.setClipGain).toBeDefined();
        const t = typeof subject.setClipGain;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
