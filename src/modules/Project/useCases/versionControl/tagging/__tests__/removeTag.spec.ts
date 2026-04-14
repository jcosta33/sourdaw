import { describe, it, expect } from 'vitest';
import * as subject from '../removeTag';

describe('removeTag', () => {
    it('should export removeTag', () => {
        expect(subject.removeTag).toBeDefined();
        const t = typeof subject.removeTag;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
