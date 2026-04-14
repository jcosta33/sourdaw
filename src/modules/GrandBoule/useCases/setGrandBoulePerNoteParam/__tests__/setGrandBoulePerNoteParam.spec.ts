import { describe, it, expect } from 'vitest';
import * as subject from '../setGrandBoulePerNoteParam';

describe('setGrandBoulePerNoteParam', () => {
    it('should export setGrandBoulePerNoteParam', () => {
        expect(subject.setGrandBoulePerNoteParam).toBeDefined();
        const t = typeof subject.setGrandBoulePerNoteParam;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
