import { describe, it, expect } from 'vitest';

import * as subject from '../clearMidiOutput';

describe('clearMidiOutput', () => {
    it('should export clearMidiOutput', () => {
        expect(subject.clearMidiOutput).toBeDefined();
        const time = typeof subject.clearMidiOutput;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
