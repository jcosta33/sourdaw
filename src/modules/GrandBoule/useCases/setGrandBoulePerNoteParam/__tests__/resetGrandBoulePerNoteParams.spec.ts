import { describe, it, expect } from 'vitest';

import * as subject from '../resetGrandBoulePerNoteParams';

describe('resetGrandBoulePerNoteParams', () => {
    it('should export resetGrandBoulePerNoteParams', () => {
        expect(subject.resetGrandBoulePerNoteParams).toBeDefined();
        const t = typeof subject.resetGrandBoulePerNoteParams;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
