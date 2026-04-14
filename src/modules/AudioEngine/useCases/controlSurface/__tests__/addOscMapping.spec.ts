import { describe, it, expect } from 'vitest';
import * as subject from '../addOscMapping';

describe('addOscMapping', () => {
    it('should export addOscMapping', () => {
        expect(subject.addOscMapping).toBeDefined();
        const t = typeof subject.addOscMapping;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
