import { describe, it, expect } from 'vitest';

import * as subject from '../selectMidiInput';

describe('selectMidiInput', () => {
    it('should export selectMidiInput', () => {
        expect(subject.selectMidiInput).toBeDefined();
        const time = typeof subject.selectMidiInput;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
