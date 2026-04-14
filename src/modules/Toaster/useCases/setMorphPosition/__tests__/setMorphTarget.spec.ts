import { describe, it, expect } from 'vitest';
import * as subject from '../setMorphTarget';

describe('setMorphTarget', () => {
    it('should export setMorphTarget', () => {
        expect(subject.setMorphTarget).toBeDefined();
        const t = typeof subject.setMorphTarget;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
