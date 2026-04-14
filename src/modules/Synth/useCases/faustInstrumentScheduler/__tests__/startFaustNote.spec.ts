import { describe, it, expect } from 'vitest';
import * as subject from '../startFaustNote';

describe('startFaustNote', () => {
    it('should export startFaustNote', () => {
        expect(subject.startFaustNote).toBeDefined();
        const t = typeof subject.startFaustNote;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
