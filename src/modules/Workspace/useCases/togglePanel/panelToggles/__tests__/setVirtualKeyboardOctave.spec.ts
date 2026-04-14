import { describe, it, expect } from 'vitest';
import * as subject from '../setVirtualKeyboardOctave';

describe('setVirtualKeyboardOctave', () => {
    it('should export setVirtualKeyboardOctave', () => {
        expect(subject.setVirtualKeyboardOctave).toBeDefined();
        const t = typeof subject.setVirtualKeyboardOctave;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
