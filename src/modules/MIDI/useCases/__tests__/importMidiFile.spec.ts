import { describe, it, expect } from 'vitest';
import * as subject from '../importMidiFile';

describe('importMidiFile', () => {
    it('should export readMidiFile', () => {
        expect(subject.readMidiFile).toBeDefined();
        const t = typeof subject.readMidiFile;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
