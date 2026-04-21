import { describe, it, expect } from 'vitest';

import * as subject from '../setSectionColor';

describe('setSectionColor', () => {
    it('should export setSectionColor', () => {
        expect(subject.setSectionColor).toBeDefined();
        const time = typeof subject.setSectionColor;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
