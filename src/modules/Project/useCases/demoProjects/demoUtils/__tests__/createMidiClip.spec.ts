import { describe, it, expect } from 'vitest';

import * as subject from '../createMidiClip';

describe('createMidiClip', () => {
    it('should export createMidiClip', () => {
        expect(subject.createMidiClip).toBeDefined();
        const time = typeof subject.createMidiClip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
