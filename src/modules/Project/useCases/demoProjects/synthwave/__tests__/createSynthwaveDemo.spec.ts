import { describe, it, expect } from 'vitest';

import * as subject from '../createSynthwaveDemo';

describe('createSynthwaveDemo', () => {
    it('should export demo4_NativeShowcase', () => {
        expect(subject.demo4_NativeShowcase).toBeDefined();
        const time = typeof subject.demo4_NativeShowcase;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
