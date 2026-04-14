import { describe, it, expect } from 'vitest';
import * as subject from '../midiNoteToCv';

describe('midiNoteToCv', () => {
    it('should export midiNoteToCv', () => {
        expect(subject.midiNoteToCv).toBeDefined();
        const t = typeof subject.midiNoteToCv;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
