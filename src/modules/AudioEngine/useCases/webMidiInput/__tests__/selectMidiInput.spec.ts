import { describe, it, expect } from 'vitest';
import * as subject from '../selectMidiInput';

describe('selectMidiInput', () => {
    it('should export selectMidiInput', () => {
        expect(subject.selectMidiInput).toBeDefined();
        const t = typeof subject.selectMidiInput;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
