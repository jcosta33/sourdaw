import { describe, it, expect } from 'vitest';
import * as subject from '../addCvOutput';

describe('addCvOutput', () => {
    it('should export addCvOutput', () => {
        expect(subject.addCvOutput).toBeDefined();
        const t = typeof subject.addCvOutput;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
