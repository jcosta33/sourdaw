import { describe, it, expect } from 'vitest';
import { NOTE_NAMES } from '../noteNames';

describe('noteNames', () => {
    it('should expose twelve chromatic names in order', () => {
        expect(NOTE_NAMES).toEqual(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
    });
});
