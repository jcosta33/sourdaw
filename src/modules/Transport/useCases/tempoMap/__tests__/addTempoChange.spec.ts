import { describe, it, expect } from 'vitest';
import * as subject from '../addTempoChange';

describe('addTempoChange', () => {
    it('should export addTempoChange', () => {
        expect(subject.addTempoChange).toBeDefined();
        const t = typeof subject.addTempoChange;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
