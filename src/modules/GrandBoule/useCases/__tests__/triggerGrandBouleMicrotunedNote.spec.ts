import { describe, it, expect } from 'vitest';

import * as subject from '../triggerGrandBouleMicrotunedNote';

describe('triggerGrandBouleMicrotunedNote', () => {
    it('should export triggerGrandBouleMicrotunedNote', () => {
        expect(subject.triggerGrandBouleMicrotunedNote).toBeDefined();
        const t = typeof subject.triggerGrandBouleMicrotunedNote;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
