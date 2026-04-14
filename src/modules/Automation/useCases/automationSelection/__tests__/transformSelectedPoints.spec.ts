import { describe, it, expect } from 'vitest';
import * as subject from '../transformSelectedPoints';

describe('transformSelectedPoints', () => {
    it('should export transformSelectedPoints', () => {
        expect(subject.transformSelectedPoints).toBeDefined();
        const t = typeof subject.transformSelectedPoints;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
