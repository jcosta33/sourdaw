import { describe, it, expect } from 'vitest';

import * as subject from '../getAllTags';

describe('getAllTags', () => {
    it('should export getAllTags', () => {
        expect(subject.getAllTags).toBeDefined();
        const t = typeof subject.getAllTags;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
