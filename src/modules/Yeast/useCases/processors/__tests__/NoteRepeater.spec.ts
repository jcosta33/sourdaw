import { describe, it, expect } from 'vitest';

import * as subject from '../NoteRepeater';

describe('NoteRepeater', () => {
    it('should export NoteRepeater', () => {
        expect(subject.NoteRepeater).toBeDefined();
        const time = typeof subject.NoteRepeater;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
