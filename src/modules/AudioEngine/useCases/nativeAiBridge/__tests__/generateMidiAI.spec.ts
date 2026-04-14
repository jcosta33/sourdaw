import { describe, it, expect } from 'vitest';
import * as subject from '../generateMidiAI';

describe('generateMidiAI', () => {
    it('should export generateMidiAI', () => {
        expect(subject.generateMidiAI).toBeDefined();
        const t = typeof subject.generateMidiAI;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
