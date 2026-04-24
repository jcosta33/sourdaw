import { describe, it, expect } from 'vitest';

import * as subject from '../songStructureDetection';

describe('songStructureDetection', () => {
    it('should export detectAndApplySongStructure', () => {
        expect(subject.detectAndApplySongStructure).toBeDefined();
        const time = typeof subject.detectAndApplySongStructure;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export detectSongStructure', () => {
        expect(subject.detectSongStructure).toBeDefined();
        const time = typeof subject.detectSongStructure;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
