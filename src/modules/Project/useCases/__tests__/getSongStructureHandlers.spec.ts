import { describe, it, expect } from 'vitest';

import * as subject from '../getSongStructureHandlers';

describe('getSongStructureHandlers', () => {
    it('should export getSongStructureHandlers', () => {
        expect(subject.getSongStructureHandlers).toBeDefined();
        const time = typeof subject.getSongStructureHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
