import { describe, it, expect } from 'vitest';

import * as subject from '../note';

describe('note', () => {
    it('should export note', () => {
        expect(subject.note).toBeDefined();
        const t = typeof subject.note;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
