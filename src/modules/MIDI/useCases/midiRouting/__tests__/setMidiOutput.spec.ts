import { describe, it, expect } from 'vitest';
import * as subject from '../setMidiOutput';

describe('setMidiOutput', () => {
    it('should export setMidiOutput', () => {
        expect(subject.setMidiOutput).toBeDefined();
        const t = typeof subject.setMidiOutput;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
