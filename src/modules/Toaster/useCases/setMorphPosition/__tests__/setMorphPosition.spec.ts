import { describe, it, expect } from 'vitest';

import * as subject from '../setMorphPosition';

describe('setMorphPosition', () => {
    it('should export setMorphPosition', () => {
        expect(subject.setMorphPosition).toBeDefined();
        const time = typeof subject.setMorphPosition;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
