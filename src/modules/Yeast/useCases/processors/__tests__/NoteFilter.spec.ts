import { describe, it, expect } from 'vitest';

import * as subject from '../NoteFilter';

describe('NoteFilter', () => {
    it('should export NoteFilter', () => {
        expect(subject.NoteFilter).toBeDefined();
        const time = typeof subject.NoteFilter;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
