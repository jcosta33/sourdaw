import { describe, it, expect } from 'vitest';
import * as subject from '../ChordMemory';

describe('ChordMemory', () => {
    it('should export ChordMemory', () => {
        expect(subject.ChordMemory).toBeDefined();
        const t = typeof subject.ChordMemory;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
