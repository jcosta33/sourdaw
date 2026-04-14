import { describe, it, expect } from 'vitest';
import * as subject from '../createSynthwaveDemo';

describe('createSynthwaveDemo', () => {
    it('should export demo4_NativeShowcase', () => {
        expect(subject.demo4_NativeShowcase).toBeDefined();
        const t = typeof subject.demo4_NativeShowcase;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
