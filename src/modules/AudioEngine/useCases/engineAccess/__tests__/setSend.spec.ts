import { describe, it, expect } from 'vitest';
import * as subject from '../setSend';

describe('setSend', () => {
    it('should export setSend', () => {
        expect(subject.setSend).toBeDefined();
        const t = typeof subject.setSend;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
