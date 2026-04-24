import { describe, it, expect } from 'vitest';

import * as subject from '../setMidiOutput';

describe('setMidiOutput', () => {
    it('should export setMidiOutput', () => {
        expect(subject.setMidiOutput).toBeDefined();
        const time = typeof subject.setMidiOutput;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
