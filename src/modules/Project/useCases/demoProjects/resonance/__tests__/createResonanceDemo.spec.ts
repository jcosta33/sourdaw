import { describe, it, expect } from 'vitest';
import * as subject from '../createResonanceDemo';

describe('createResonanceDemo', () => {
    it('should export demo1_TheCompleteMix', () => {
        expect(subject.demo1_TheCompleteMix).toBeDefined();
        const t = typeof subject.demo1_TheCompleteMix;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
