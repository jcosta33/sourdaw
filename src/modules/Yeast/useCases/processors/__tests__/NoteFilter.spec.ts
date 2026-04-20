import { describe, it, expect } from 'vitest';

import * as subject from '../NoteFilter';

describe('NoteFilter', () => {
    it('should export NoteFilter', () => {
        expect(subject.NoteFilter).toBeDefined();
        const t = typeof subject.NoteFilter;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
