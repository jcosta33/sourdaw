import { describe, it, expect } from 'vitest';
import * as subject from '../deleteCueMix';

describe('deleteCueMix', () => {
    it('should export deleteCueMix', () => {
        expect(subject.deleteCueMix).toBeDefined();
        const t = typeof subject.deleteCueMix;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
