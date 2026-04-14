import { describe, it, expect } from 'vitest';
import * as subject from '../getSnapshot';

describe('getSnapshot', () => {
    it('should export getSnapshot', () => {
        expect(subject.getSnapshot).toBeDefined();
        const t = typeof subject.getSnapshot;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
