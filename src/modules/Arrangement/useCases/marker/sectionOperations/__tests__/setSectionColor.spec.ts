import { describe, it, expect } from 'vitest';

import * as subject from '../setSectionColor';

describe('setSectionColor', () => {
    it('should export setSectionColor', () => {
        expect(subject.setSectionColor).toBeDefined();
        const t = typeof subject.setSectionColor;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
