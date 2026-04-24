import { describe, it, expect } from 'vitest';

import * as subject from '../ChordMemory';

describe('ChordMemory', () => {
    it('should export ChordMemory', () => {
        expect(subject.ChordMemory).toBeDefined();
        const time = typeof subject.ChordMemory;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
