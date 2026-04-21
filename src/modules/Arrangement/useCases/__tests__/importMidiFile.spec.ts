import { describe, it, expect } from 'vitest';

import * as subject from '../importMidiFile';

describe('importMidiFile', () => {
    it('should export importMidiFile', () => {
        expect(subject.importMidiFile).toBeDefined();
        const time = typeof subject.importMidiFile;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
