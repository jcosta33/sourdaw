import { describe, it, expect } from 'vitest';

import * as subject from '../toggleMorph';

describe('toggleMorph', () => {
    it('should export toggleMorph', () => {
        expect(subject.toggleMorph).toBeDefined();
        const t = typeof subject.toggleMorph;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
