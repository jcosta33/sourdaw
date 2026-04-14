import { describe, it, expect } from 'vitest';
import * as subject from '../songStructureDetection';

describe('songStructureDetection', () => {
    it('should export detectAndApplySongStructure', () => {
        expect(subject.detectAndApplySongStructure).toBeDefined();
        const t = typeof subject.detectAndApplySongStructure;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export detectSongStructure', () => {
        expect(subject.detectSongStructure).toBeDefined();
        const t = typeof subject.detectSongStructure;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
