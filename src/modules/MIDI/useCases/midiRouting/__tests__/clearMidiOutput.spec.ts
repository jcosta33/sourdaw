import { describe, it, expect } from 'vitest';
import * as subject from '../clearMidiOutput';

describe('clearMidiOutput', () => {
    it('should export clearMidiOutput', () => {
        expect(subject.clearMidiOutput).toBeDefined();
        const t = typeof subject.clearMidiOutput;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
