import { describe, it, expect } from 'vitest';

import * as subject from '../processRealtimeMidiInput';

describe('processRealtimeMidiInput', () => {
    it('should export processRealtimeMidiInput', () => {
        expect(subject.processRealtimeMidiInput).toBeDefined();
        const t = typeof subject.processRealtimeMidiInput;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export processYeastMidi', () => {
        expect(subject.processYeastMidi).toBeDefined();
        const t = typeof subject.processYeastMidi;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
