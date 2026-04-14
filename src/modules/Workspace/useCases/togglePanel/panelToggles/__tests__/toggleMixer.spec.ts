import { describe, it, expect } from 'vitest';
import * as subject from '../toggleMixer';

describe('toggleMixer', () => {
    it('should export toggleMixer', () => {
        expect(subject.toggleMixer).toBeDefined();
        const t = typeof subject.toggleMixer;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
