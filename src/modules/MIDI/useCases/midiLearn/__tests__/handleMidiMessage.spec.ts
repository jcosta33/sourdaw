import { describe, it, expect } from 'vitest';

import * as subject from '../handleMidiMessage';

describe('handleMidiMessage', () => {
    it('should export handleMidiMessage', () => {
        expect(subject.handleMidiMessage).toBeDefined();
        const time = typeof subject.handleMidiMessage;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export scaleMidiValue', () => {
        expect(subject.scaleMidiValue).toBeDefined();
        const time = typeof subject.scaleMidiValue;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
