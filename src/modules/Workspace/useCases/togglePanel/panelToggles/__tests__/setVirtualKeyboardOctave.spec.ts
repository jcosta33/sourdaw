import { describe, it, expect } from 'vitest';

import * as subject from '../setVirtualKeyboardOctave';

describe('setVirtualKeyboardOctave', () => {
    it('should export setVirtualKeyboardOctave', () => {
        expect(subject.setVirtualKeyboardOctave).toBeDefined();
        const time = typeof subject.setVirtualKeyboardOctave;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
