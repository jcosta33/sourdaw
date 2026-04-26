import { describe, it, expect } from 'vitest';

import * as subject from '../toggleMorph';

describe('toggleMorph', () => {
    it('should export toggleMorph', () => {
        expect(subject.toggleMorph).toBeDefined();
        const time = typeof subject.toggleMorph;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
