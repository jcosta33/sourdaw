import { describe, it, expect } from 'vitest';
import * as subject from '../getAudioContext';

describe('getAudioContext', () => {
    it('should export getAudioContext', () => {
        expect(subject.getAudioContext).toBeDefined();
        const t = typeof subject.getAudioContext;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
