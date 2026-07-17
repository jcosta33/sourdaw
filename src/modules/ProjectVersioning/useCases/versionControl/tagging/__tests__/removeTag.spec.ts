import { describe, it, expect } from 'vitest';

import * as subject from '../removeTag';

describe('removeTag', () => {
    it('should export removeTag', () => {
        expect(subject.removeTag).toBeDefined();
        const time = typeof subject.removeTag;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
