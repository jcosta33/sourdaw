import { describe, it, expect } from 'vitest';

import * as subject from '../note';

describe('note', () => {
    it('should export note', () => {
        expect(subject.note).toBeDefined();
        const time = typeof subject.note;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
