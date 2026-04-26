import { describe, it, expect } from 'vitest';

import * as subject from '../importMidiFile';

describe('importMidiFile', () => {
    it('should export readMidiFile', () => {
        expect(subject.readMidiFile).toBeDefined();
        const time = typeof subject.readMidiFile;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
