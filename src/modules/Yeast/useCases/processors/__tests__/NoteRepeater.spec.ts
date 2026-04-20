import { describe, it, expect } from 'vitest';

import * as subject from '../NoteRepeater';

describe('NoteRepeater', () => {
    it('should export NoteRepeater', () => {
        expect(subject.NoteRepeater).toBeDefined();
        const t = typeof subject.NoteRepeater;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
