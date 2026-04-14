import { describe, it, expect } from 'vitest';
import * as subject from '../importMidiFile';

describe('importMidiFile', () => {
    it('should export importMidiFile', () => {
        expect(subject.importMidiFile).toBeDefined();
        const t = typeof subject.importMidiFile;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
