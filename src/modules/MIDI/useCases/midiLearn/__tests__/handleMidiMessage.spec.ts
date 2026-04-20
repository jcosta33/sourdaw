import { describe, it, expect } from 'vitest';

import * as subject from '../handleMidiMessage';

describe('handleMidiMessage', () => {
    it('should export handleMidiMessage', () => {
        expect(subject.handleMidiMessage).toBeDefined();
        const t = typeof subject.handleMidiMessage;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export scaleMidiValue', () => {
        expect(subject.scaleMidiValue).toBeDefined();
        const t = typeof subject.scaleMidiValue;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
