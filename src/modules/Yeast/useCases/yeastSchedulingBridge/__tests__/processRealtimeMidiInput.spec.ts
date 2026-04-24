import { describe, it, expect } from 'vitest';

import * as subject from '../processRealtimeMidiInput';

describe('processRealtimeMidiInput', () => {
    it('should export processRealtimeMidiInput', () => {
        expect(subject.processRealtimeMidiInput).toBeDefined();
        const time = typeof subject.processRealtimeMidiInput;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export processYeastMidi', () => {
        expect(subject.processYeastMidi).toBeDefined();
        const time = typeof subject.processYeastMidi;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
