import { describe, it, expect } from 'vitest';

import * as subject from '../createMidiClip';

describe('createMidiClip', () => {
    it('should export createMidiClip', () => {
        expect(subject.createMidiClip).toBeDefined();
        const t = typeof subject.createMidiClip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
