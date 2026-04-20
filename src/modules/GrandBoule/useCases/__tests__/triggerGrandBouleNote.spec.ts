import { describe, it, expect } from 'vitest';

import * as subject from '../triggerGrandBouleNote';

describe('triggerGrandBouleNote', () => {
    it('should export triggerGrandBouleNote', () => {
        expect(subject.triggerGrandBouleNote).toBeDefined();
        const t = typeof subject.triggerGrandBouleNote;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
