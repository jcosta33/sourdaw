import { describe, it, expect } from 'vitest';

import * as subject from '../setMorphPosition';

describe('setMorphPosition', () => {
    it('should export setMorphPosition', () => {
        expect(subject.setMorphPosition).toBeDefined();
        const t = typeof subject.setMorphPosition;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
