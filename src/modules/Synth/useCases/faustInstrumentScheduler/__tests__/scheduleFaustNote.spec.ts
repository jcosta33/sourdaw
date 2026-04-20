import { describe, it, expect } from 'vitest';

import * as subject from '../scheduleFaustNote';

describe('scheduleFaustNote', () => {
    it('should export scheduleFaustNote', () => {
        expect(subject.scheduleFaustNote).toBeDefined();
        const t = typeof subject.scheduleFaustNote;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
