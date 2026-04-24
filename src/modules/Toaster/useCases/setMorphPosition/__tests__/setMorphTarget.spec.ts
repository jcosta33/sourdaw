import { describe, it, expect } from 'vitest';

import * as subject from '../setMorphTarget';

describe('setMorphTarget', () => {
    it('should export setMorphTarget', () => {
        expect(subject.setMorphTarget).toBeDefined();
        const time = typeof subject.setMorphTarget;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
