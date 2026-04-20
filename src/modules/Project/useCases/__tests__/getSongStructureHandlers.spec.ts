import { describe, it, expect } from 'vitest';

import * as subject from '../getSongStructureHandlers';

describe('getSongStructureHandlers', () => {
    it('should export getSongStructureHandlers', () => {
        expect(subject.getSongStructureHandlers).toBeDefined();
        const t = typeof subject.getSongStructureHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
